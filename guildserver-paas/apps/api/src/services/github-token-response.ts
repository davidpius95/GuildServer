/**
 * Read the fields worth keeping from GitHub's OAuth token-exchange response.
 *
 * A classic OAuth App returns a long-lived `access_token` and nothing else.
 * A GitHub App returns a short-lived user token (typically 8 hours) together
 * with `refresh_token` and `expires_in`. The callback kept only
 * `access_token`, so every GitHub App connection silently died about 8 hours
 * after it was made and could never be renewed: getValidAccessToken() had no
 * refresh token to use and no recorded expiry to notice.
 */

export interface GithubTokenFields {
  accessToken: string;
  /** Present only for GitHub App user tokens. */
  refreshToken?: string;
  /** Absent means the token does not expire (classic OAuth App). */
  tokenExpiresAt?: Date;
}

export function githubTokenFields(
  tokenData: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown },
  now: number = Date.now(),
): GithubTokenFields {
  const refreshToken =
    typeof tokenData.refresh_token === "string" && tokenData.refresh_token.length > 0
      ? tokenData.refresh_token
      : undefined;

  // JSON responses give a number; form-encoded ones give a string. Anything
  // that is not a positive finite number is treated as "no expiry" rather than
  // inventing one, which would force refreshes a classic token cannot perform.
  const seconds = Number(tokenData.expires_in);
  const tokenExpiresAt = Number.isFinite(seconds) && seconds > 0 ? new Date(now + seconds * 1000) : undefined;

  return { accessToken: String(tokenData.access_token ?? ""), refreshToken, tokenExpiresAt };
}
