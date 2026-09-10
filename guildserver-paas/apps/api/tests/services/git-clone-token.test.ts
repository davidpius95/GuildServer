jest.mock('../../src/services/oauth-tokens', () => {
  const actual = jest.requireActual('../../src/services/oauth-tokens');
  return { ...actual, getValidAccessToken: jest.fn() };
});

import { db, users, oauthAccounts } from '@guildserver/database';
import { getValidAccessToken, TokenRefreshRequiredError } from '../../src/services/oauth-tokens';
import { resolveCloneToken } from '../../src/services/git-clone-token';

const mockedGetValid = getValidAccessToken as jest.MockedFunction<typeof getValidAccessToken>;

describe('resolveCloneToken', () => {
  beforeEach(() => mockedGetValid.mockReset());

  it.each(['github', 'gitlab', 'bitbucket'])('goes through getValidAccessToken for %s', async (provider) => {
    mockedGetValid.mockResolvedValue('fresh-token');
    const result = await resolveCloneToken('user-1', provider);
    expect(mockedGetValid).toHaveBeenCalledWith('user-1', provider);
    expect(result.token).toBe('fresh-token');
    expect(result.note).toMatch(/authenticated clone/);
  });

  it('clones without credentials, and says why, when the connection cannot be renewed', async () => {
    // The old path handed git the dead token, which also breaks public repos.
    mockedGetValid.mockRejectedValue(new TokenRefreshRequiredError('github'));
    const result = await resolveCloneToken('user-1', 'github');
    expect(result.token).toBeUndefined();
    expect(result.note).toMatch(/reconnect github/);
  });

  it('does not fail the deploy when refreshing throws something unexpected', async () => {
    mockedGetValid.mockRejectedValue(new Error('ECONNRESET'));
    const result = await resolveCloneToken('user-1', 'gitlab');
    expect(result.token).toBeUndefined();
    expect(result.note).toMatch(/unauthenticated clone/);
  });

  describe('providers without a refresh flow', () => {
    it('reads the stored token directly, as before', async () => {
      const [user] = await db
        .insert(users)
        .values({ email: `gitea-${Date.now()}@example.com`, name: 'Gitea User' } as any)
        .returning();
      await db.insert(oauthAccounts).values({
        userId: user.id,
        provider: 'gitea',
        providerAccountId: `gitea-${Date.now()}`,
        accessToken: 'gitea-token',
      } as any);

      const result = await resolveCloneToken(user.id, 'gitea');
      expect(mockedGetValid).not.toHaveBeenCalled();
      expect(result.token).toBe('gitea-token');
    });

    it('falls back to an unauthenticated clone when no account exists', async () => {
      const result = await resolveCloneToken('00000000-0000-0000-0000-000000000000', 'gitea');
      expect(result.token).toBeUndefined();
      expect(result.note).toMatch(/No OAuth token found/);
    });
  });
});
