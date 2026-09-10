import { githubTokenFields } from '../../src/services/github-token-response';

const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);

describe('githubTokenFields', () => {
  it('keeps the refresh token and expiry a GitHub App returns', () => {
    const fields = githubTokenFields(
      { access_token: 'ghu_abc', refresh_token: 'ghr_def', expires_in: 28800 },
      NOW,
    );
    expect(fields.accessToken).toBe('ghu_abc');
    expect(fields.refreshToken).toBe('ghr_def');
    expect(fields.tokenExpiresAt?.getTime()).toBe(NOW + 28800 * 1000);
  });

  it('records no expiry and no refresh token for a classic OAuth App token', () => {
    // Inventing an expiry here would force refreshes a classic token can never
    // perform, disconnecting users with perfectly good tokens.
    const fields = githubTokenFields({ access_token: 'gho_abc', scope: 'repo' } as any, NOW);
    expect(fields.refreshToken).toBeUndefined();
    expect(fields.tokenExpiresAt).toBeUndefined();
  });

  it('accepts expires_in as a string, as form-encoded responses send it', () => {
    const fields = githubTokenFields({ access_token: 'ghu_abc', refresh_token: 'ghr', expires_in: '3600' }, NOW);
    expect(fields.tokenExpiresAt?.getTime()).toBe(NOW + 3600 * 1000);
  });

  it.each([0, -5, 'soon', null, undefined, NaN])('ignores an unusable expires_in (%p)', (value) => {
    expect(githubTokenFields({ access_token: 'x', expires_in: value }, NOW).tokenExpiresAt).toBeUndefined();
  });

  it('ignores an empty refresh token', () => {
    expect(githubTokenFields({ access_token: 'x', refresh_token: '' }, NOW).refreshToken).toBeUndefined();
  });
});
