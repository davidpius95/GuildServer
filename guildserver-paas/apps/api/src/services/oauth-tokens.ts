/**
 * OAuth access-token lifecycle for connected git providers.
 *
 * The OAuth handlers already persist `refreshToken` and `tokenExpiresAt`, but
 * nothing ever used them: once an access token expired, every call failed with
 * "Bad credentials" and the only way out was for the user to manually
 * reconnect. Every stored Google, GitLab and Bitbucket token in production was
 * expired with an unused refresh token sitting next to it.
 *
 * getValidAccessToken() refreshes transparently when a token is expired or
 * about to be, persists the new pair, and returns a usable token.
 *
 * Note on GitHub: a GitHub App issues short-lived user tokens WITH a refresh
 * token, while a classic OAuth App issues long-lived tokens with none. We
 * handle both — no refresh token simply means the token cannot be renewed and
 * the user has to reconnect, which the caller surfaces as a reconnect prompt.
 */

import { db, oauthAccounts } from "@guildserver/database";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";

export type GitProvider = "github" | "gitlab" | "bitbucket" | "google";

/** Refresh this far ahead of expiry so a token can't die mid-request. */
const EXPIRY_SKEW_MS = 120_000;

export class TokenRefreshRequiredError extends Error {
  constructor(public provider: string) {
    super(`${provider} connection expired`);
    this.name = "TokenRefreshRequiredError";
  }
}

interface RefreshEndpoint {
  url: string;
  clientId?: string;
  clientSecret?: string;
  /** GitHub wants form-encoded and returns JSON only with an Accept header. */
  acceptJson?: boolean;
}

function endpointFor(provider: GitProvider): RefreshEndpoint | null {
  switch (provider) {
    case "github":
      return {
        url: "https://github.com/login/oauth/access_token",
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        acceptJson: true,
      };
    case "gitlab":
      return {
        url: "https://gitlab.com/oauth/token",
        clientId: process.env.GITLAB_CLIENT_ID,
        clientSecret: process.env.GITLAB_CLIENT_SECRET,
      };
    case "bitbucket":
      return {
        url: "https://bitbucket.org/site/oauth2/access_token",
        clientId: process.env.BITBUCKET_CLIENT_ID,
        clientSecret: process.env.BITBUCKET_CLIENT_SECRET,
      };
    case "google":
      return {
        url: "https://oauth2.googleapis.com/token",
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      };
    default:
      return null;
  }
}

async function refresh(
  provider: GitProvider,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
  const ep = endpointFor(provider);
  if (!ep?.clientId || !ep?.clientSecret) {
    throw new TokenRefreshRequiredError(provider);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: ep.clientId,
    client_secret: ep.clientSecret,
  });

  const res = await fetch(ep.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(ep.acceptJson ? { Accept: "application/json" } : {}),
    },
    body,
  });

  const data: any = await res.json().catch(() => ({}));

  // A refused refresh means the grant was revoked — the user must reconnect;
  // retrying will never succeed.
  if (!res.ok || data.error || !data.access_token) {
    logger.warn("OAuth token refresh rejected", {
      provider,
      status: res.status,
      error: data.error ?? `HTTP ${res.status}`,
    });
    throw new TokenRefreshRequiredError(provider);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

/**
 * Return a usable access token for this user+provider, refreshing if needed.
 *
 * Throws TokenRefreshRequiredError when the connection cannot be recovered
 * without the user re-authorising, so callers can prompt to reconnect rather
 * than surfacing a raw provider error.
 */
export async function getValidAccessToken(
  userId: string,
  provider: GitProvider,
): Promise<string> {
  const account = await db.query.oauthAccounts.findFirst({
    where: and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)),
  });

  if (!account?.accessToken) throw new TokenRefreshRequiredError(provider);

  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : null;
  const stillValid = expiresAt === null || Date.now() < expiresAt - EXPIRY_SKEW_MS;

  // No recorded expiry means a long-lived token (classic OAuth App): use it and
  // let the caller handle a 401 if it was revoked.
  if (stillValid) return account.accessToken;

  if (!account.refreshToken) {
    logger.info("Access token expired with no refresh token available", { provider, userId });
    throw new TokenRefreshRequiredError(provider);
  }

  const refreshed = await refresh(provider, account.refreshToken);

  await db
    .update(oauthAccounts)
    .set({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? account.refreshToken,
      tokenExpiresAt: refreshed.expiresAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(oauthAccounts.id, account.id));

  logger.info("Refreshed OAuth access token", {
    provider,
    userId,
    expiresAt: refreshed.expiresAt?.toISOString() ?? "none",
  });

  return refreshed.accessToken;
}

/** True when a provider error means the stored grant is dead. */
export function isAuthFailure(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error);
  return /401|Bad credentials|invalid_token|unauthorized/i.test(msg);
}
