import type { SignOptions } from "jsonwebtoken";

/**
 * Lifetime of a signed-in session token: JWT_EXPIRES_IN (a jsonwebtoken
 * duration such as "7d" or "12h", or a number of seconds), default 7 days.
 */
export function sessionTokenLifetime(env: NodeJS.ProcessEnv = process.env): NonNullable<SignOptions["expiresIn"]> {
  const value = env.JWT_EXPIRES_IN?.trim();
  if (!value) return "7d";
  return /^\d+$/.test(value) ? Number(value) : (value as NonNullable<SignOptions["expiresIn"]>);
}
