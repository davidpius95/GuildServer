import { eq, sql } from "drizzle-orm";
import { db, logDrains, applications, services, projects } from "@guildserver/database";
import { decryptSecret } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import type { DrainSpec } from "./manager";
import type { DrainTarget, ShipperReport } from "./shipper";

interface StoredTarget {
  url: string;
  headers?: Record<string, string>;
}

export function readDrainTarget(row: { secret: string; format: string }): DrainTarget {
  const plain = decryptSecret(row.secret);
  if (!plain) throw new Error("the drain's stored endpoint could not be decrypted");
  const stored = JSON.parse(plain) as StoredTarget;
  return { url: stored.url, headers: stored.headers ?? {}, format: row.format === "ndjson" ? "ndjson" : "json" };
}

/** Enabled drains whose resource still belongs to the drain's organization. */
export async function loadDrainSpecs(): Promise<DrainSpec[]> {
  const applicationDrains = await db
    .select({ drain: logDrains, name: applications.appName, organizationId: projects.organizationId })
    .from(logDrains)
    .innerJoin(applications, eq(logDrains.applicationId, applications.id))
    .innerJoin(projects, eq(applications.projectId, projects.id))
    .where(eq(logDrains.enabled, true));
  const serviceDrains = await db
    .select({ drain: logDrains, name: services.name, organizationId: projects.organizationId })
    .from(logDrains)
    .innerJoin(services, eq(logDrains.serviceId, services.id))
    .innerJoin(projects, eq(services.projectId, projects.id))
    .where(eq(logDrains.enabled, true));

  const specs: DrainSpec[] = [];
  const add = (rows: typeof applicationDrains, type: "application" | "service") => {
    for (const row of rows) {
      if (row.organizationId !== row.drain.organizationId) {
        logger.warn(`Log drain ${row.drain.id} skipped: its ${type} belongs to another organization`);
        continue;
      }
      try {
        specs.push({
          id: row.drain.id,
          organizationId: row.drain.organizationId,
          resourceType: type,
          resourceId: (type === "application" ? row.drain.applicationId : row.drain.serviceId)!,
          resourceName: row.name,
          target: readDrainTarget(row.drain),
        });
      } catch (error: any) {
        logger.warn(`Log drain ${row.drain.id} skipped: ${error?.message}`);
      }
    }
  };
  add(applicationDrains, "application");
  add(serviceDrains, "service");
  return specs;
}

export async function saveDrainReport(drainId: string, report: ShipperReport): Promise<void> {
  await db
    .update(logDrains)
    .set({
      lastDeliveryAt: report.at,
      lastDeliveryOk: report.ok,
      lastError: report.error,
      recordsSent: sql`${logDrains.recordsSent} + ${report.sent}`,
      recordsDropped: sql`${logDrains.recordsDropped} + ${report.dropped}`,
    })
    .where(eq(logDrains.id, drainId));
}
