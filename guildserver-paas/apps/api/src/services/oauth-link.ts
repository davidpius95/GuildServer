/**
 * Link an OAuth account to the user who is already signed in.
 *
 * Sign-in matches an OAuth identity to a GuildServer account by email. This
 * platform's GitHub App cannot read private email addresses ("Resource not
 * accessible by integration"), so the callback fell back to a placeholder
 * noreply address, matched nobody, and created a second, empty account when a
 * signed-in user clicked "Connect GitHub" in Settings.
 *
 * Linking therefore carries the user's identity explicitly, and because
 * attaching an OAuth account to a user is equivalent to granting sign-in as
 * that user, every step is defended:
 *
 *  1. The dashboard (JWT-authenticated) mints a short-lived link token.
 *  2. The browser POSTs it — never a URL, so it stays out of access logs and
 *     Referer headers — and only from the frontend's own Origin, so another
 *     site cannot submit its token from a victim's browser and attach the
 *     victim's GitHub account to the attacker.
 *  3. The token is single-use, and the user it names is kept server-side in
 *     Redis, keyed by the OAuth state nonce. The `state` value that travels
 *     through GitHub carries no identity, so a forged state cannot redirect a
 *     link to someone else.
 *  4. Linking never creates a user, and refuses an OAuth identity already
 *     attached to a different user.
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import IORedis from "ioredis";
import { and, eq } from "drizzle-orm";
import { db, oauthAccounts } from "@guildserver/database";
import { logger } from "../utils/logger";

export const LINK_TOKEN_TTL_SECONDS = 300;
/** How long a started link may take to come back from the provider. */
const LINK_STATE_TTL_SECONDS = 600;
const AUDIENCE = "guildserver-oauth-link";

export type LinkProvider = "github";

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not set");
  return value;
}

/**
 * The subject is `sub`, not `userId`, so a link token presented as a session
 * JWT resolves to no user in createContext and authenticates nothing.
 */
export function createLinkToken(userId: string, provider: LinkProvider): string {
  return jwt.sign({ provider }, secret(), {
    subject: userId,
    audience: AUDIENCE,
    expiresIn: LINK_TOKEN_TTL_SECONDS,
    jwtid: crypto.randomUUID(),
    algorithm: "HS256",
  });
}

export function verifyLinkToken(token: unknown, provider: LinkProvider): { userId: string; jti: string } | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  try {
    const decoded = jwt.verify(token, secret(), { audience: AUDIENCE, algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (decoded.provider !== provider || typeof decoded.sub !== "string" || typeof decoded.jti !== "string") {
      return null;
    }
    return { userId: decoded.sub, jti: decoded.jti };
  } catch {
    return null;
  }
}

export function isAllowedLinkOrigin(origin: string | undefined, frontendUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(frontendUrl).origin;
  } catch {
    return false;
  }
}

type RedisLike = {
  set: (...args: any[]) => Promise<unknown>;
  getdel: (key: string) => Promise<string | null>;
};

let client: IORedis | null = null;

function defaultRedis(): RedisLike {
  if (!client) {
    client = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: 1 });
  }
  return client;
}

export async function closeLinkRedis(): Promise<void> {
  if (!client) return;
  const current = client;
  client = null;
  await current.quit().catch(() => current.disconnect());
}

/** Mark a link token as used. True only the first time. Fails closed. */
export async function consumeLinkJti(jti: string, redis: RedisLike = defaultRedis()): Promise<boolean> {
  try {
    const result = await redis.set(`oauth-link:jti:${jti}`, "1", "EX", LINK_TOKEN_TTL_SECONDS, "NX");
    return result === "OK";
  } catch (error) {
    logger.warn("Could not record OAuth link token use; refusing the link", {
      error: String((error as any)?.message ?? error),
    });
    return false;
  }
}

/** Remember which user a started link belongs to, keyed by the state nonce. */
export async function rememberLinkState(nonce: string, userId: string, redis: RedisLike = defaultRedis()): Promise<boolean> {
  try {
    const result = await redis.set(`oauth-link:state:${nonce}`, userId, "EX", LINK_STATE_TTL_SECONDS, "NX");
    return result === "OK";
  } catch (error) {
    logger.warn("Could not store OAuth link state; refusing the link", {
      error: String((error as any)?.message ?? error),
    });
    return false;
  }
}

/** Retrieve and delete the user for a returning link. Null if absent or already taken. */
export async function takeLinkState(nonce: string, redis: RedisLike = defaultRedis()): Promise<string | null> {
  if (!nonce) return null;
  try {
    return await redis.getdel(`oauth-link:state:${nonce}`);
  } catch (error) {
    logger.warn("Could not read OAuth link state; refusing the link", {
      error: String((error as any)?.message ?? error),
    });
    return null;
  }
}

export type LinkResult = { status: "linked" } | { status: "conflict" };

export async function linkOAuthAccountToUser(params: {
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scope?: string;
}): Promise<LinkResult> {
  const existing = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(oauthAccounts.provider, params.provider),
      eq(oauthAccounts.providerAccountId, params.providerAccountId),
    ),
  });

  // Never move an identity away from the user who owns it.
  if (existing && existing.userId !== params.userId) return { status: "conflict" };

  const mine =
    existing ??
    (await db.query.oauthAccounts.findFirst({
      where: and(eq(oauthAccounts.userId, params.userId), eq(oauthAccounts.provider, params.provider)),
    }));

  const values = {
    accessToken: params.accessToken,
    // A re-link that omits a refresh token must not erase a stored one.
    refreshToken: params.refreshToken ?? mine?.refreshToken ?? null,
    tokenExpiresAt: params.tokenExpiresAt ?? null,
    scope: params.scope ?? null,
    updatedAt: new Date(),
  };

  if (mine) {
    // Same identity refreshed, or the user switching to a different account.
    await db
      .update(oauthAccounts)
      .set({ ...values, providerAccountId: params.providerAccountId })
      .where(eq(oauthAccounts.id, mine.id));
    return { status: "linked" };
  }

  await db.insert(oauthAccounts).values({
    userId: params.userId,
    provider: params.provider,
    providerAccountId: params.providerAccountId,
    ...values,
  });
  return { status: "linked" };
}
