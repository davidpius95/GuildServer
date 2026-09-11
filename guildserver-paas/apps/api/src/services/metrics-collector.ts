import { db, metrics, applications } from "@guildserver/database";
import { eq, inArray, lt } from "drizzle-orm";
import { logger } from "../utils/logger";
import { collectAllMetrics, getContainerSummary } from "./container-manager";
import { broadcastToAll } from "../websocket/server";

/**
 * Metrics Collector Service
 * Periodically collects Docker container stats and stores them in the database.
 * Also broadcasts real-time metrics via WebSocket.
 */

let collectionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Collect metrics from all running containers and store in DB
 */
export async function collectAndStoreMetrics(): Promise<void> {
  try {
    const allMetrics = await collectAllMetrics();

    if (allMetrics.length === 0) {
      logger.debug("No running containers to collect metrics from");
      return;
    }

    const now = new Date();

    for (const { applicationId, stats } of allMetrics) {
      // Look up the app to get its organizationId
      const app = await db.query.applications.findFirst({
        where: eq(applications.id, applicationId),
        with: {
          project: {
            columns: { organizationId: true },
          },
        },
      });

      if (!app || !app.project) continue;
      const orgId = app.project.organizationId;

      // Store CPU metric
      await db.insert(metrics).values({
        name: "cpu_percent",
        type: "gauge",
        value: stats.cpuPercent.toString(),
        labels: { applicationId },
        applicationId,
        organizationId: orgId,
        timestamp: now,
      });

      // Store Memory metric (MB)
      await db.insert(metrics).values({
        name: "memory_usage_mb",
        type: "gauge",
        value: stats.memoryUsageMb.toString(),
        labels: { applicationId, limitMb: stats.memoryLimitMb.toString() },
        applicationId,
        organizationId: orgId,
        timestamp: now,
      });

      // Store Memory percent
      await db.insert(metrics).values({
        name: "memory_percent",
        type: "gauge",
        value: stats.memoryPercent.toString(),
        labels: { applicationId },
        applicationId,
        organizationId: orgId,
        timestamp: now,
      });

      // Store Network RX bytes
      await db.insert(metrics).values({
        name: "network_rx_bytes",
        type: "counter",
        value: stats.networkRxBytes.toString(),
        labels: { applicationId },
        applicationId,
        organizationId: orgId,
        timestamp: now,
      });

      // Store Network TX bytes
      await db.insert(metrics).values({
        name: "network_tx_bytes",
        type: "counter",
        value: stats.networkTxBytes.toString(),
        labels: { applicationId },
        applicationId,
        organizationId: orgId,
        timestamp: now,
      });
    }

    // Broadcast summary to all connected WebSocket clients
    const summary = await getContainerSummary();
    broadcastToAll({
      type: "metrics_update",
      timestamp: now.toISOString(),
      containers: summary,
      applications: allMetrics.map(({ applicationId, stats }) => ({
        applicationId,
        cpu: stats.cpuPercent,
        memory: stats.memoryUsageMb,
        memoryPercent: stats.memoryPercent,
        networkRx: stats.networkRxBytes,
        networkTx: stats.networkTxBytes,
      })),
    });

    logger.debug(`Collected metrics for ${allMetrics.length} containers`);
  } catch (error: any) {
    logger.error(`Metrics collection error: ${error.message}`);
  }
}

/**
 * Start periodic metrics collection
 * @param intervalMs - Collection interval in milliseconds (default: 15 seconds)
 */
export function startMetricsCollection(intervalMs: number = 15000): void {
  if (collectionInterval) {
    logger.warn("Metrics collection already running");
    return;
  }

  // Collect immediately
  collectAndStoreMetrics();

  // Then collect periodically
  collectionInterval = setInterval(collectAndStoreMetrics, intervalMs);
  logger.info(`✅ Metrics collection started (every ${intervalMs / 1000}s)`);
}

/**
 * Stop periodic metrics collection
 */
export function stopMetricsCollection(): void {
  if (collectionInterval) {
    clearInterval(collectionInterval);
    collectionInterval = null;
    logger.info("Metrics collection stopped");
  }
}

/** Longest range the dashboards query (monitoring.getMetrics "30d"). */
export const DEFAULT_METRICS_RETENTION_DAYS = 30;

/** METRICS_RETENTION_DAYS, or 30 when unset or not a whole number of days >= 1. */
export function metricsRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.METRICS_RETENTION_DAYS);
  return Number.isInteger(days) && days >= 1 ? days : DEFAULT_METRICS_RETENTION_DAYS;
}

/**
 * Delete raw metrics older than the retention window.
 *
 * The collector writes a handful of rows per container every 15 seconds, so
 * without this the table grows without bound. Deletes run in batches through
 * the timestamp index so no single statement holds locks on millions of rows.
 * Returns the number of rows removed.
 */
export async function cleanupOldMetrics(
  retentionDays: number = metricsRetentionDays(),
  { batchSize = 10_000, now = new Date() }: { batchSize?: number; now?: Date } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  let removed = 0;

  for (;;) {
    const expired = db
      .select({ id: metrics.id })
      .from(metrics)
      .where(lt(metrics.timestamp, cutoff))
      .limit(batchSize);
    const deleted = await db
      .delete(metrics)
      .where(inArray(metrics.id, expired))
      .returning({ id: metrics.id });
    removed += deleted.length;
    if (deleted.length < batchSize) break;
  }

  logger.info(`Metrics retention: removed ${removed} row(s) older than ${retentionDays} day(s)`);
  return removed;
}
