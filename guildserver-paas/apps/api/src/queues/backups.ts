import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { eq, lt } from "drizzle-orm";
import { db, databaseBackups } from "@guildserver/database";
import { logger } from "../utils/logger";
import { DatabaseBackupService } from "../services/db-backup";

// Self-contained Redis connection (mirrors queues/instances.ts) so this module
// is independent of the existing deployment/instance queues.
const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const backupQueue = new Queue("backups", { connection: redis });

type BackupJob =
  | { type: "backup"; databaseId: string; backupId: string; backupType: "manual" | "automatic" }
  | { type: "restore"; backupId: string }
  | { type: "retention-sweep" };

/** Enqueue an immediate dump for an already-created backup record. */
export async function addBackupJob(
  databaseId: string,
  backupId: string,
  backupType: "manual" | "automatic" = "manual",
) {
  return backupQueue.add(
    "backup",
    { type: "backup", databaseId, backupId, backupType } satisfies BackupJob,
    { removeOnComplete: 50, removeOnFail: 50, attempts: 2, backoff: { type: "exponential", delay: 5000 } },
  );
}

export async function addRestoreJob(backupId: string) {
  return backupQueue.add(
    "restore",
    { type: "restore", backupId } satisfies BackupJob,
    { removeOnComplete: 50, removeOnFail: 50, attempts: 1 },
  );
}

/** Cron expression for a database's automatic backup schedule. */
function cronFor(frequency: string, hour: number | null): string {
  const h = hour ?? 3; // default 03:00
  switch (frequency) {
    case "hourly":
      return "0 * * * *";
    case "weekly":
      return `0 ${h} * * 0`; // Sundays
    case "daily":
    default:
      return `0 ${h} * * *`;
  }
}

/** Stable repeatable-job id so we can add/remove a database's schedule. */
function scheduleJobId(databaseId: string): string {
  return `auto-backup-${databaseId}`;
}

/**
 * Register or remove a database's automatic-backup repeatable job to match its
 * current settings. Call after create / settings changes / delete.
 */
export async function syncBackupSchedule(database: {
  id: string;
  backupEnabled?: boolean | null;
  backupFrequency?: string | null;
  backupHour?: number | null;
}): Promise<void> {
  const jobId = scheduleJobId(database.id);

  // Remove any existing schedule for this database first (idempotent).
  const repeatables = await backupQueue.getRepeatableJobs();
  for (const r of repeatables) {
    if (r.id === jobId) {
      await backupQueue.removeRepeatableByKey(r.key);
    }
  }

  if (!database.backupEnabled) return;

  const cron = cronFor(database.backupFrequency || "daily", database.backupHour ?? null);
  await backupQueue.add(
    "scheduled-backup",
    { type: "backup", databaseId: database.id, backupId: "", backupType: "automatic" } satisfies BackupJob,
    { repeat: { pattern: cron }, jobId, removeOnComplete: 20, removeOnFail: 20 },
  );
  logger.info(`Synced automatic backup schedule for database ${database.id} (${cron})`);
}

/** Delete backups whose retention window has passed (file + DB row). */
async function runRetentionSweep(): Promise<void> {
  const expired = await db.query.databaseBackups.findMany({
    where: lt(databaseBackups.expiresAt, new Date()),
  });
  for (const backup of expired) {
    await DatabaseBackupService.deleteBackupFile(backup.filePath);
    await db.delete(databaseBackups).where(eq(databaseBackups.id, backup.id));
  }
  if (expired.length > 0) logger.info(`Retention sweep removed ${expired.length} expired backup(s)`);
}

const backupWorker = new Worker(
  "backups",
  async (job) => {
    const data = job.data as BackupJob;
    if (data.type === "backup") {
      // Scheduled jobs arrive without a backupId — create the record now.
      let backupId = data.backupId;
      if (!backupId) {
        const record = await DatabaseBackupService.triggerBackup(data.databaseId, data.backupType);
        backupId = record.id;
      }
      await DatabaseBackupService.runBackup(backupId);
    } else if (data.type === "restore") {
      await DatabaseBackupService.restoreBackup(data.backupId);
    } else if (data.type === "retention-sweep") {
      await runRetentionSweep();
    }
  },
  { connection: redis, concurrency: 2 },
);

backupWorker.on("failed", (job, err) => {
  logger.error("Backup job failed", { jobId: job?.id, error: err?.message });
});

// Register the recurring retention sweep (hourly) once on startup.
backupQueue
  .add(
    "retention-sweep",
    { type: "retention-sweep" } satisfies BackupJob,
    { repeat: { pattern: "0 * * * *" }, jobId: "retention-sweep", removeOnComplete: 5, removeOnFail: 5 },
  )
  .catch((err) => logger.error("Failed to register retention sweep", { error: err.message }));

export { backupWorker };
