jest.mock('../../src/services/github-app', () => {
  const actual = jest.requireActual('../../src/services/github-app');
  return {
    ...actual,
    githubAppConfigured: jest.fn(() => false),
    installationTokenForRepository: jest.fn(),
    userCanReadRepository: jest.fn(),
  };
});
jest.mock('../../src/services/oauth-tokens', () => {
  const actual = jest.requireActual('../../src/services/oauth-tokens');
  return { ...actual, getValidAccessToken: jest.fn() };
});

import { db, users, oauthAccounts } from '@guildserver/database';
import { getValidAccessToken, TokenRefreshRequiredError } from '../../src/services/oauth-tokens';
import { resolveCloneToken } from '../../src/services/git-clone-token';

import { githubAppConfigured, installationTokenForRepository, userCanReadRepository } from '../../src/services/github-app';

const mockedGetValid = getValidAccessToken as jest.MockedFunction<typeof getValidAccessToken>;
const mockedAppConfigured = githubAppConfigured as jest.MockedFunction<typeof githubAppConfigured>;
const mockedInstallationToken = installationTokenForRepository as jest.MockedFunction<typeof installationTokenForRepository>;
const mockedCanRead = userCanReadRepository as jest.MockedFunction<typeof userCanReadRepository>;

describe('resolveCloneToken', () => {
  beforeEach(() => {
    mockedGetValid.mockReset();
    mockedAppConfigured.mockReset().mockReturnValue(false);
    mockedInstallationToken.mockReset();
    mockedCanRead.mockReset().mockResolvedValue(true);
  });

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

describe('resolveCloneToken with a GitHub App installed', () => {
  beforeEach(() => {
    mockedGetValid.mockReset();
    mockedAppConfigured.mockReset().mockReturnValue(true);
    mockedInstallationToken.mockReset();
    mockedCanRead.mockReset().mockResolvedValue(true);
  });

  it('prefers the installation token, so a deploy does not depend on who connected the repo', async () => {
    mockedGetValid.mockResolvedValue('user-token');
    mockedInstallationToken.mockResolvedValue('ghs_installation');
    const result = await resolveCloneToken('user-1', 'github', 'https://github.com/acme/shop.git');
    expect(mockedInstallationToken).toHaveBeenCalledWith('acme', 'shop');
    expect(result.token).toBe('ghs_installation');
    expect(result.note).toMatch(/installation token/i);
    // The user's identity is still consulted — not to clone with, but to
    // confirm this repository is theirs to deploy before the App's
    // credentials are used on it.
    expect(mockedGetValid).toHaveBeenCalledWith('user-1', 'github');
  });

  it("falls back to the user's token when the app is not installed on that repository", async () => {
    mockedInstallationToken.mockResolvedValue(null);
    mockedGetValid.mockResolvedValue('user-token');
    mockedCanRead.mockResolvedValue(true);
    const result = await resolveCloneToken('user-1', 'github', 'acme/shop');
    expect(result.token).toBe('user-token');
    expect(result.note).toMatch(/OAuth token/);
  });

  it('does not reach for an installation token for other providers', async () => {
    mockedGetValid.mockResolvedValue('gitlab-token');
    const result = await resolveCloneToken('user-1', 'gitlab', 'acme/shop');
    expect(mockedInstallationToken).not.toHaveBeenCalled();
    expect(result.token).toBe('gitlab-token');
  });
});

describe('one App, many tenants', () => {
  beforeEach(() => {
    mockedGetValid.mockReset();
    mockedAppConfigured.mockReset().mockReturnValue(true);
    mockedInstallationToken.mockReset();
    mockedCanRead.mockReset();
  });

  it("never mints an installation token for a repository this user cannot read", async () => {
    // Another tenant installed the App on their account; naming their private
    // repository must not borrow the App's access.
    mockedGetValid.mockResolvedValue('user-token');
    mockedCanRead.mockResolvedValue(false);
    mockedInstallationToken.mockResolvedValue('ghs_other_tenant');

    const result = await resolveCloneToken('user-1', 'github', 'otherOrg/private-repo');

    expect(mockedInstallationToken).not.toHaveBeenCalled();
    expect(result.token).not.toBe('ghs_other_tenant');
  });

  it('checks access with the requesting user\'s own token', async () => {
    mockedGetValid.mockResolvedValue('user-token');
    mockedCanRead.mockResolvedValue(true);
    mockedInstallationToken.mockResolvedValue('ghs_installation');

    await resolveCloneToken('user-1', 'github', 'acme/shop');

    expect(mockedCanRead).toHaveBeenCalledWith('user-token', 'acme', 'shop');
  });

  it('does not reach for the App when the user has no usable GitHub connection', async () => {
    mockedGetValid.mockRejectedValue(new TokenRefreshRequiredError('github'));
    mockedInstallationToken.mockResolvedValue('ghs_installation');

    const result = await resolveCloneToken('user-1', 'github', 'acme/shop');

    expect(mockedInstallationToken).not.toHaveBeenCalled();
    expect(result.token).toBeUndefined();
    expect(result.note).toMatch(/reconnect github/);
  });
});

jest.mock('../../src/services/github-installations', () => ({ installationForOwner: jest.fn() }));

describe('an organization that installed the App itself', () => {
  const { installationForOwner } = require('../../src/services/github-installations');
  const mockedOwned = installationForOwner as jest.MockedFunction<any>;

  beforeEach(() => {
    mockedGetValid.mockReset().mockResolvedValue('user-token');
    mockedAppConfigured.mockReset().mockReturnValue(true);
    mockedInstallationToken.mockReset().mockResolvedValue('ghs_installation');
    mockedCanRead.mockReset().mockResolvedValue(true);
    mockedOwned.mockReset();
  });

  it('says which account the installation belongs to when the organization owns it', async () => {
    mockedOwned.mockResolvedValue({ accountLogin: 'acme-inc' });
    const result = await resolveCloneToken('user-1', 'github', 'acme-inc/shop', 'org-1');
    expect(mockedOwned).toHaveBeenCalledWith('org-1', 'acme-inc');
    expect(result.token).toBe('ghs_installation');
    expect(result.note).toMatch(/installed on acme-inc/);
  });

  it('still deploys when the organization has recorded no installation', async () => {
    mockedOwned.mockResolvedValue(null);
    const result = await resolveCloneToken('user-1', 'github', 'acme-inc/shop', 'org-1');
    expect(result.token).toBe('ghs_installation');
    expect(result.note).toMatch(/installation token/);
  });

  it('does not look for an installation when the deploy carries no organization', async () => {
    const result = await resolveCloneToken('user-1', 'github', 'acme-inc/shop');
    expect(mockedOwned).not.toHaveBeenCalled();
    expect(result.token).toBe('ghs_installation');
  });
});
