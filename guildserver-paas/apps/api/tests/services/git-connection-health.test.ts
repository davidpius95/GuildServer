/**
 * checkConnectionHealth against the real test database, with providers mocked.
 */
import { db, users, oauthAccounts } from '@guildserver/database';
import { checkConnectionHealth, clearConnectionHealth } from '../../src/services/git-connection-health';

const DAY = 24 * 60 * 60 * 1000;

async function connectedUser(overrides: Record<string, unknown> = {}) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ email: `health-${stamp}@example.com`, name: 'Health User' } as any)
    .returning();
  await db.insert(oauthAccounts).values({
    userId: user.id,
    provider: 'github',
    providerAccountId: `gh-${stamp}`,
    accessToken: 'ghu_live',
    tokenExpiresAt: new Date(Date.now() + 2 * DAY),
    refreshToken: 'ghr_refresh',
    ...overrides,
  } as any);
  return user;
}

const status = (code: number) => new Response('{}', { status: code, headers: { 'content-type': 'application/json' } });

describe('checkConnectionHealth', () => {
  beforeEach(() => clearConnectionHealth());

  it('reports connected when the provider accepts the token', async () => {
    const user = await connectedUser();
    const fetchImpl = jest.fn().mockResolvedValue(status(200));
    await expect(checkConnectionHealth(user.id, 'github', { fetchImpl })).resolves.toBe('connected');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/user');
    expect(init.headers.Authorization).toBe('Bearer ghu_live');
  });

  it('reports reconnect_required when the provider rejects the token with 401', async () => {
    const user = await connectedUser();
    const fetchImpl = jest.fn().mockResolvedValue(status(401));
    await expect(checkConnectionHealth(user.id, 'github', { fetchImpl })).resolves.toBe('reconnect_required');
  });

  it('reports reconnect_required without calling the provider when the token expired with no refresh token', async () => {
    const user = await connectedUser({ tokenExpiresAt: new Date(Date.now() - DAY), refreshToken: null });
    const fetchImpl = jest.fn();
    await expect(checkConnectionHealth(user.id, 'github', { fetchImpl })).resolves.toBe('reconnect_required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports reconnect_required when there is no stored connection', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `health-none-${Date.now()}@example.com`, name: 'No Connection' } as any)
      .returning();
    await expect(checkConnectionHealth(user.id, 'github', { fetchImpl: jest.fn() })).resolves.toBe('reconnect_required');
  });

  it.each([
    ['a rate limit', () => Promise.resolve(status(403))],
    ['a provider outage', () => Promise.resolve(status(502))],
    ['a network failure', () => Promise.reject(new Error('ETIMEDOUT'))],
  ])('reports unknown, not reconnect_required, on %s', async (_label, respond) => {
    const user = await connectedUser();
    const fetchImpl = jest.fn().mockImplementation(respond);
    await expect(checkConnectionHealth(user.id, 'github', { fetchImpl })).resolves.toBe('unknown');
  });

  it('caches a healthy answer for a minute, and re-checks anything else', async () => {
    const user = await connectedUser();
    const fetchImpl = jest.fn().mockResolvedValue(status(200));
    const now = Date.now();
    await checkConnectionHealth(user.id, 'github', { fetchImpl, now });
    await checkConnectionHealth(user.id, 'github', { fetchImpl, now: now + 30_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await checkConnectionHealth(user.id, 'github', { fetchImpl, now: now + 61_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const flaky = jest.fn().mockRejectedValueOnce(new Error('ETIMEDOUT')).mockResolvedValue(status(200));
    const other = await connectedUser();
    await expect(checkConnectionHealth(other.id, 'github', { fetchImpl: flaky, now })).resolves.toBe('unknown');
    await expect(checkConnectionHealth(other.id, 'github', { fetchImpl: flaky, now })).resolves.toBe('connected');

    // A dead connection is re-checked, so reconnecting shows up at once.
    const revoked = await connectedUser();
    const reconnecting = jest.fn().mockResolvedValueOnce(status(401)).mockResolvedValue(status(200));
    await expect(checkConnectionHealth(revoked.id, 'github', { fetchImpl: reconnecting, now })).resolves.toBe('reconnect_required');
    await expect(checkConnectionHealth(revoked.id, 'github', { fetchImpl: reconnecting, now })).resolves.toBe('connected');
  });

  it('forgets cached answers for a user when cleared', async () => {
    const user = await connectedUser();
    const fetchImpl = jest.fn().mockResolvedValueOnce(status(200)).mockResolvedValue(status(401));
    const now = Date.now();
    await expect(checkConnectionHealth(user.id, 'github', { fetchImpl, now })).resolves.toBe('connected');
    clearConnectionHealth(user.id);
    await expect(checkConnectionHealth(user.id, 'github', { fetchImpl, now })).resolves.toBe('reconnect_required');
  });
});
