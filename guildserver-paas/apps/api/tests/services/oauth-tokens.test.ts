/**
 * getValidAccessToken against the real test database, with GitHub mocked.
 *
 * Expiry margins are measured in days on purpose: timestamps are stored
 * without a time zone, and these tests assert which branch runs, not
 * minute-level precision.
 */
import { db, users, oauthAccounts } from '@guildserver/database';
import { eq } from 'drizzle-orm';
import { getValidAccessToken, TokenRefreshRequiredError } from '../../src/services/oauth-tokens';

const DAY = 24 * 60 * 60 * 1000;
const originalFetch = global.fetch;

async function account(overrides: Record<string, unknown>) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ email: `oauth-${stamp}@example.com`, name: 'OAuth User' } as any)
    .returning();
  const [row] = await db
    .insert(oauthAccounts)
    .values({ userId: user.id, provider: 'github', providerAccountId: `gh-${stamp}`, ...overrides } as any)
    .returning();
  return { user, row };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('getValidAccessToken', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns a token with no recorded expiry without calling GitHub', async () => {
    const { user } = await account({ accessToken: 'gho_classic' });
    await expect(getValidAccessToken(user.id, 'github')).resolves.toBe('gho_classic');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an unexpired token without calling GitHub', async () => {
    const { user } = await account({
      accessToken: 'ghu_live',
      refreshToken: 'ghr_live',
      tokenExpiresAt: new Date(Date.now() + 2 * DAY),
    });
    await expect(getValidAccessToken(user.id, 'github')).resolves.toBe('ghu_live');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renews an expired token and persists the new pair', async () => {
    const { user, row } = await account({
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      tokenExpiresAt: new Date(Date.now() - 2 * DAY),
    });
    fetchMock.mockResolvedValue(
      jsonResponse({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800 }),
    );

    await expect(getValidAccessToken(user.id, 'github')).resolves.toBe('ghu_new');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('ghr_old');

    // GitHub invalidates the old refresh token when it issues a new one, so
    // failing to persist the new pair would break the connection permanently.
    const [stored] = await db.select().from(oauthAccounts).where(eq(oauthAccounts.id, row.id));
    expect(stored.accessToken).toBe('ghu_new');
    expect(stored.refreshToken).toBe('ghr_new');
    expect(stored.tokenExpiresAt).not.toBeNull();
  });

  it('asks for a reconnect when an expired token has no refresh token', async () => {
    const { user } = await account({ accessToken: 'ghu_dead', tokenExpiresAt: new Date(Date.now() - 2 * DAY) });
    await expect(getValidAccessToken(user.id, 'github')).rejects.toBeInstanceOf(TokenRefreshRequiredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for a reconnect, and leaves the row untouched, when GitHub refuses the refresh', async () => {
    const { user, row } = await account({
      accessToken: 'ghu_old',
      refreshToken: 'ghr_revoked',
      tokenExpiresAt: new Date(Date.now() - 2 * DAY),
    });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad_refresh_token' }, 400));

    await expect(getValidAccessToken(user.id, 'github')).rejects.toBeInstanceOf(TokenRefreshRequiredError);

    const [stored] = await db.select().from(oauthAccounts).where(eq(oauthAccounts.id, row.id));
    expect(stored.accessToken).toBe('ghu_old');
    expect(stored.refreshToken).toBe('ghr_revoked');
  });
});
