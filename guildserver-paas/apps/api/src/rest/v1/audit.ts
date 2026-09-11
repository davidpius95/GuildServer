/**
 * Audit entries for actions taken with an API token.
 */
import type { Request } from "express";
import { isIP } from "net";
import { auditLogs, db } from "@guildserver/database";
import type { AuthenticatedToken } from "../../services/api-tokens";
import { logger } from "../../utils/logger";

export async function recordApiAction(
  req: Request,
  token: AuthenticatedToken,
  entry: { action: string; resourceType: string; resourceId: string; resourceName?: string | null },
): Promise<void> {
  // ip_address is an inet column: an unparseable value would fail the insert.
  const rawIp = req.ip ?? "";
  const ip = isIP(rawIp) ? rawIp : null;
  try {
    await db.insert(auditLogs).values({
      userId: token.userId,
      organizationId: token.organizationId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      resourceName: entry.resourceName ?? null,
      metadata: { via: "api-token", tokenId: token.tokenId, tokenPrefix: token.tokenPrefix },
      ipAddress: ip,
      userAgent: req.get("User-Agent")?.slice(0, 500) ?? null,
      timestamp: new Date(),
    });
  } catch (error) {
    // The action already happened; failing the response now would invite a
    // retry that repeats it.
    logger.error("Could not write API audit entry", {
      action: entry.action,
      tokenId: token.tokenId,
      error: String((error as any)?.message ?? error),
    });
  }
}
