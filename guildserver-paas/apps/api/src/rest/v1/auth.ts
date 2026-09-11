/**
 * Bearer-token authentication and scope checks for /api/v1.
 */
import type { NextFunction, Request, Response } from "express";
import {
  authenticateApiToken,
  recordApiTokenUse,
  scopeSatisfies,
  type ApiTokenScope,
  type AuthenticatedToken,
} from "../../services/api-tokens";
import { logger } from "../../utils/logger";
import { RestError, sendError, toRestError } from "./errors";

/** The authenticated token, set by `authenticate`. */
export function tokenOf(res: Response): AuthenticatedToken {
  const token = res.locals.apiToken as AuthenticatedToken | undefined;
  if (!token) throw new RestError("UNAUTHORIZED", "Invalid or missing API token");
  return token;
}

/**
 * Every failure — no header, a JWT, a wrong prefix, unknown, revoked, expired,
 * user gone or no longer a member — is the same 401, so a caller cannot probe
 * which it was.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const match = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? "");
    const token = match ? await authenticateApiToken(match[1]) : null;
    if (!token) {
      sendError(res, new RestError("UNAUTHORIZED", "Invalid or missing API token"));
      return;
    }
    res.locals.apiToken = token;

    // Bookkeeping must never fail or slow the request it describes.
    recordApiTokenUse(token, req.ip).catch((error) =>
      logger.warn("Could not record API token use", { tokenId: token.tokenId, error: String(error?.message ?? error) }),
    );
    next();
  } catch (error) {
    sendError(res, toRestError(error));
  }
}

export function requireScope(scope: ApiTokenScope) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const token = res.locals.apiToken as AuthenticatedToken | undefined;
    if (!token) {
      sendError(res, new RestError("UNAUTHORIZED", "Invalid or missing API token"));
      return;
    }
    if (!scopeSatisfies(token.scopes, scope)) {
      sendError(res, new RestError("FORBIDDEN", `This endpoint requires the "${scope}" scope`));
      return;
    }
    next();
  };
}
