/**
 * The REST API's single error shape: { "error": { "code", "message" } }.
 */
import type { Response } from "express";
import { TRPCError } from "@trpc/server";
import { logger } from "../../utils/logger";

export type RestErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST" | "RATE_LIMITED" | "INTERNAL";

const STATUS: Record<RestErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class RestError extends Error {
  constructor(
    public readonly code: RestErrorCode,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "RestError";
  }
}

export function sendError(res: Response, error: RestError): void {
  for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
  res.status(STATUS[error.code]).json({ error: { code: error.code, message: error.message } });
}

export const notFound = () => new RestError("NOT_FOUND", "Resource not found");

/**
 * Translate anything thrown inside a handler.
 *
 * Organization and project ownership is checked before any tRPC procedure is
 * called, so a tRPC FORBIDDEN here cannot be about another tenant's resource;
 * it is surfaced as 403. Anything unrecognised becomes a generic 500 with no
 * message or stack from the original error.
 */
export function toRestError(error: unknown): RestError {
  if (error instanceof RestError) return error;
  if (error instanceof TRPCError) {
    switch (error.code) {
      case "NOT_FOUND":
        return notFound();
      case "UNAUTHORIZED":
        return new RestError("UNAUTHORIZED", "Invalid or missing API token");
      case "FORBIDDEN":
        return new RestError("FORBIDDEN", error.message || "Forbidden");
      case "BAD_REQUEST":
      case "PARSE_ERROR":
      case "PRECONDITION_FAILED":
      case "CONFLICT":
        return new RestError("BAD_REQUEST", error.message || "Bad request");
      case "TOO_MANY_REQUESTS":
        return new RestError("RATE_LIMITED", "Too many requests", { "Retry-After": "60" });
      default:
        break;
    }
  }
  logger.error("REST API request failed", { error: String((error as any)?.message ?? error) });
  return new RestError("INTERNAL", "Internal error");
}
