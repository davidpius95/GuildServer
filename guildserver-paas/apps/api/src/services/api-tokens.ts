/**
 * Scoped personal access tokens (PATs) for the public REST API at /api/v1.
 *
 * Format: `gs_pat_` + base64url(32 random bytes). Only the SHA-256 hex digest
 * of the whole token is stored. 256 bits of entropy makes a slow password hash
 * pointless, and a plain digest permits an indexed equality lookup per request.
 *
 * A token acts AS its user WITHIN its organization. It never grants more than
 * the user has: every REST call is authorized by the same tRPC procedures the
 * dashboard uses, with the token's scopes and project restriction applied on
 * top. Removing the user from the organization therefore disables the token
 * without a separate revocation step (see `authenticateApiToken`).
 *
 * The plaintext is returned once, from `createApiToken`, and must never be
 * persisted or logged anywhere.
 */

import crypto from "crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { apiTokens, db, members, projects, users } from "@guildserver/database";

export const API_TOKEN_PREFIX = "gs_pat_";

export const API_TOKEN_SCOPES = ["read", "deploy", "write", "admin"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** 32 bytes base64url-encoded without padding is exactly 43 characters. */
const TOKEN_PATTERN = /^gs_pat_[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApiTokenRecord = typeof apiTokens.$inferSelect;

export interface AuthenticatedToken {
  tokenId: string;
  tokenPrefix: string;
  name: string;
  organizationId: string;
  userId: string;
  scopes: ApiTokenScope[];
  /** null means every project in the organization the user can reach. */
  projectIds: string[] | null;
  lastUsedAt: Date | null;
  /** The organization role of the token's user at authentication time. */
  memberRole: "owner" | "admin" | "member";
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "admin" | "user" | null;
  };
}

export class ApiTokenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiTokenValidationError";
  }
}

export function hashApiToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateApiToken(): { token: string; tokenPrefix: string; tokenHash: string } {
  const random = crypto.randomBytes(32).toString("base64url");
  const token = `${API_TOKEN_PREFIX}${random}`;
  return {
    token,
    tokenPrefix: `${API_TOKEN_PREFIX}${random.slice(0, 8)}`,
    tokenHash: hashApiToken(token),
  };
}

export function isValidScope(scope: unknown): scope is ApiTokenScope {
  return typeof scope === "string" && (API_TOKEN_SCOPES as readonly string[]).includes(scope);
}

/**
 * Does a token holding `granted` satisfy `required`?
 *
 *   admin  => write, deploy, read
 *   write  => read
 *   deploy => read
 *
 * deploy and write deliberately do not imply each other: a CI token that can
 * ship a build should not be able to rewrite configuration, and vice versa.
 */
export function scopeSatisfies(granted: readonly string[], required: ApiTokenScope): boolean {
  if (granted.includes("admin")) return true;
  if (granted.includes(required)) return true;
  if (required === "read") return granted.includes("write") || granted.includes("deploy");
  return false;
}

function normalizeScopes(scopes: unknown): ApiTokenScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ApiTokenValidationError("At least one scope is required");
  }
  for (const scope of scopes) {
    if (!isValidScope(scope)) {
      throw new ApiTokenValidationError(
        `Invalid scope ${JSON.stringify(scope)}; expected one of ${API_TOKEN_SCOPES.join(", ")}`,
      );
    }
  }
  // Stable order, no duplicates.
  return API_TOKEN_SCOPES.filter((s) => (scopes as string[]).includes(s));
}

export async function createApiToken(input: {
  organizationId: string;
  userId: string;
  name: string;
  scopes: string[];
  projectIds?: string[] | null;
  expiresAt?: Date | null;
}): Promise<{ token: string; record: ApiTokenRecord }> {
  if (typeof input.organizationId !== "string" || !UUID_PATTERN.test(input.organizationId)) {
    throw new ApiTokenValidationError("organizationId must be a UUID");
  }
  if (typeof input.userId !== "string" || !UUID_PATTERN.test(input.userId)) {
    throw new ApiTokenValidationError("userId must be a UUID");
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new ApiTokenValidationError("Token name is required");
  if (name.length > 255) throw new ApiTokenValidationError("Token name must be at most 255 characters");

  const scopes = normalizeScopes(input.scopes);

  // A past expiry is accepted here on purpose: such a token is dead on arrival
  // (authenticateApiToken rejects it), so it grants nothing, and callers such as
  // tests need a way to mint one. The user-facing `apiToken.create` procedure is
  // where "must be in the future" is enforced.
  let expiresAt: Date | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
      throw new ApiTokenValidationError("expiresAt must be a valid date");
    }
    expiresAt = input.expiresAt;
  }

  // The user must currently belong to the organization; a token for a
  // non-member would be dead on arrival and almost certainly a caller bug.
  const membership = await db.query.members.findFirst({
    where: and(eq(members.organizationId, input.organizationId), eq(members.userId, input.userId)),
  });
  if (!membership) {
    throw new ApiTokenValidationError("User is not a member of the organization");
  }

  let projectIds: string[] | null = null;
  if (input.projectIds !== undefined && input.projectIds !== null) {
    if (!Array.isArray(input.projectIds) || input.projectIds.length === 0) {
      // An empty restriction would silently mean "no projects"; reject it so
      // nobody confuses it with "all projects" (which is null).
      throw new ApiTokenValidationError("projectIds must be a non-empty array, or null for all projects");
    }
    const unique = Array.from(new Set(input.projectIds));
    if (unique.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
      throw new ApiTokenValidationError("projectIds must contain only UUIDs");
    }
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(inArray(projects.id, unique), eq(projects.organizationId, input.organizationId)));
    if (rows.length !== unique.length) {
      throw new ApiTokenValidationError("Every project in projectIds must belong to the organization");
    }
    projectIds = unique;
  }

  const { token, tokenPrefix, tokenHash } = generateApiToken();
  const [record] = await db
    .insert(apiTokens)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      name,
      tokenPrefix,
      tokenHash,
      scopes,
      projectIds,
      expiresAt,
    })
    .returning();

  return { token, record };
}

export async function revokeApiToken(id: string): Promise<void> {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return;
  const now = new Date();
  await db
    .update(apiTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)));
}

/**
 * Resolve a raw bearer token to the identity it acts as, or null.
 *
 * Null covers every failure — malformed, unknown, revoked, expired, user gone,
 * user no longer a member of the token's organization — so callers cannot
 * accidentally distinguish them in a response.
 */
export async function authenticateApiToken(rawToken: string): Promise<AuthenticatedToken | null> {
  if (typeof rawToken !== "string" || !TOKEN_PATTERN.test(rawToken)) return null;

  const record = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.tokenHash, hashApiToken(rawToken)),
  });
  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null;

  const [membership] = await db
    .select({
      role: members.role,
      userId: users.id,
      email: users.email,
      name: users.name,
      userRole: users.role,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.organizationId, record.organizationId), eq(members.userId, record.userId)))
    .limit(1);
  if (!membership) return null;

  const scopes = (Array.isArray(record.scopes) ? record.scopes : []).filter(isValidScope);
  if (scopes.length === 0) return null;

  const projectIds = Array.isArray(record.projectIds) ? record.projectIds : null;

  return {
    tokenId: record.id,
    tokenPrefix: record.tokenPrefix,
    name: record.name,
    organizationId: record.organizationId,
    userId: record.userId,
    scopes,
    projectIds,
    lastUsedAt: record.lastUsedAt ?? null,
    memberRole: membership.role,
    user: {
      id: membership.userId,
      email: membership.email,
      name: membership.name,
      role: membership.userRole,
    },
  };
}

/** lastUsedAt / lastUsedIp are written at most this often per token. */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/**
 * Record that a token was used, at most once per LAST_USED_WRITE_INTERVAL_MS.
 *
 * The in-hand `lastUsedAt` (read during authentication) skips the write on the
 * hot path without another query. The conditional WHERE makes concurrent
 * requests, or several API replicas, collapse to a single write per interval.
 * Returns whether a row was updated.
 */
export async function recordApiTokenUse(
  token: Pick<AuthenticatedToken, "tokenId" | "lastUsedAt">,
  ip: string | null | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (token.lastUsedAt && now.getTime() - token.lastUsedAt.getTime() < LAST_USED_WRITE_INTERVAL_MS) {
    return false;
  }
  const threshold = new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS);
  const updated = await db
    .update(apiTokens)
    .set({ lastUsedAt: now, lastUsedIp: ip ? ip.slice(0, 64) : null })
    .where(
      and(
        eq(apiTokens.id, token.tokenId),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, threshold)),
      ),
    )
    .returning({ id: apiTokens.id });
  return updated.length > 0;
}

/** Columns safe to show in a token listing: never the hash. */
export function toPublicApiToken(record: ApiTokenRecord) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    userId: record.userId,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    scopes: record.scopes,
    projectIds: record.projectIds ?? null,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    lastUsedIp: record.lastUsedIp,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
