/**
 * Choose the credential used to clone a repository during a deploy.
 *
 * The deploy worker used to read `oauth_accounts.access_token` directly. That
 * bypassed getValidAccessToken(), so an expired token was handed to git as-is:
 * private repositories stopped deploying about 8 hours after GitHub was
 * connected, and a dead token in the clone URL makes GitHub refuse even a
 * public repository.
 */

import { db, oauthAccounts } from "@guildserver/database";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { getValidAccessToken, TokenRefreshRequiredError, type GitProvider } from "./oauth-tokens";

/** Providers whose tokens getValidAccessToken() knows how to renew. */
const REFRESHABLE: readonly GitProvider[] = ["github", "gitlab", "bitbucket"];

export interface CloneTokenResult {
  /** Undefined means clone without credentials. */
  token?: string;
  /** One line for the build log explaining which path was taken. */
  note: string;
}

export async function resolveCloneToken(userId: string, provider: string): Promise<CloneTokenResult> {
  if ((REFRESHABLE as readonly string[]).includes(provider)) {
    try {
      const token = await getValidAccessToken(userId, provider as GitProvider);
      return { token, note: "Using authenticated clone (OAuth token found)" };
    } catch (error) {
      if (!(error instanceof TokenRefreshRequiredError)) {
        // A network failure while refreshing should not fail the whole deploy
        // before git has even been tried.
        logger.warn("Could not obtain a clone token", { provider, error: String((error as any)?.message ?? error) });
      }
      // Falling back is strictly better than using a dead token: a public
      // repository clones fine without credentials, and a private one fails
      // with the same outcome it would have had anyway, plus a clear hint.
      return {
        token: undefined,
        note:
          `No usable ${provider} connection (missing or expired) — attempting unauthenticated clone. ` +
          `If this repository is private, reconnect ${provider} in settings.`,
      };
    }
  }

  // Providers without a refresh flow keep the previous behaviour.
  const account = await db.query.oauthAccounts.findFirst({
    where: and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)),
  });
  if (account?.accessToken) {
    return { token: account.accessToken, note: "Using authenticated clone (OAuth token found)" };
  }
  return { token: undefined, note: "No OAuth token found — attempting unauthenticated clone" };
}
