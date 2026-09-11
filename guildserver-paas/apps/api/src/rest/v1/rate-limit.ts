/**
 * Per-token request limit for /api/v1.
 *
 * A fixed one-minute window held in this process's memory. That is correct
 * for the API as deployed today (one replica). With several replicas each
 * would enforce the limit independently, so the effective limit would scale
 * with replica count; moving the counter to Redis is the fix if that changes.
 *
 * The limit is read from GS_API_RATE_LIMIT_PER_MINUTE on every request so it
 * can be changed, and lowered in tests, without a restart.
 */
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedToken } from "../../services/api-tokens";
import { RestError, sendError } from "./errors";

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 600;

const windows = new Map<string, { start: number; count: number }>();

export function currentLimit(): number {
  const parsed = Number.parseInt(process.env.GS_API_RATE_LIMIT_PER_MINUTE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

/** For tests. */
export function resetRateLimits(): void {
  windows.clear();
}

export function rateLimit(_req: Request, res: Response, next: NextFunction): void {
  const token = res.locals.apiToken as AuthenticatedToken | undefined;
  if (!token) return next();

  const now = Date.now();
  let entry = windows.get(token.tokenId);
  if (!entry || now - entry.start >= WINDOW_MS) {
    entry = { start: now, count: 0 };
    windows.set(token.tokenId, entry);
  }
  entry.count++;

  // Keep the map from growing without bound on a long-lived process.
  if (windows.size > 10_000) {
    for (const [id, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(id);
  }

  if (entry.count > currentLimit()) {
    const retryAfter = Math.max(1, Math.ceil((entry.start + WINDOW_MS - now) / 1000));
    sendError(res, new RestError("RATE_LIMITED", "Too many requests for this token", { "Retry-After": String(retryAfter) }));
    return;
  }
  next();
}
