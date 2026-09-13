/**
 * Audit entries for actions taken in the dashboard.
 *
 * The API already records actions taken with an API token (see
 * rest/v1/audit.ts). This is the same record for the dashboard's own
 * mutations, so "who deleted that application?" has an answer regardless of
 * which door the request came through.
 */

import { isIP } from "net";
import { auditLogs, db } from "@guildserver/database";
import { logger } from "../utils/logger";

/** Just enough of Express's Request to record the caller. */
export interface AuditRequest {
  ip?: string;
  get?(header: string): string | undefined;
}

export interface AuditEntry {
  userId: string;
  organizationId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  metadata?: Record<string, unknown>;
}

/** ip_address is an inet column: an unparseable value would fail the insert. */
export function clientIp(req?: AuditRequest): string | null {
  const raw = req?.ip ?? "";
  return isIP(raw) ? raw : null;
}

export async function recordAudit(entry: AuditEntry, req?: AuditRequest): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId,
      organizationId: entry.organizationId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      resourceName: entry.resourceName?.slice(0, 255) ?? null,
      metadata: { via: "dashboard", ...(entry.metadata ?? {}) },
      ipAddress: clientIp(req),
      userAgent: req?.get?.("User-Agent")?.slice(0, 500) ?? null,
      timestamp: new Date(),
    });
  } catch (error) {
    // The action already happened; failing the response now would invite a
    // retry that repeats it.
    logger.error("Could not write audit entry", {
      action: entry.action,
      resourceId: entry.resourceId,
      error: String((error as any)?.message ?? error),
    });
  }
}
