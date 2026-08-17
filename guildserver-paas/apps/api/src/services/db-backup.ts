import { db } from "@guildserver/database";
import { databaseBackups, databases } from "@guildserver/database";
import { eq } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";
import { execInContainer, getAppContainer } from "./docker/container";
import { logger } from "../utils/logger";

/** Root directory for backup files; overridable via env. */
const BACKUP_ROOT = process.env.BACKUP_DIR || "/var/lib/guildserver/backups";

interface EngineSpec {
  /** File extension for the dump. */
  ext: string;
  /** Build the dump command (writes the backup to stdout). */
  dump: (db: { databaseName: string; username: string; password: string }) => string[];
  /** Build the restore command (reads the backup from stdin). */
  restore: (db: { databaseName: string; username: string; password: string }) => string[];
}

const ENGINES: Record<string, EngineSpec> = {
  postgresql: {
    ext: "dump",
    dump: (d) => ["pg_dump", "-U", d.username, "-Fc", d.databaseName],
    restore: (d) => ["pg_restore", "-U", d.username, "-d", d.databaseName, "--clean", "--if-exists"],
  },
  mysql: {
    ext: "sql",
    dump: (d) => ["sh", "-c", `mysqldump -u${d.username} -p${d.password} ${d.databaseName}`],
    restore: (d) => ["sh", "-c", `mysql -u${d.username} -p${d.password} ${d.databaseName}`],
  },
  mariadb: {
    ext: "sql",
    dump: (d) => ["sh", "-c", `mysqldump -u${d.username} -p${d.password} ${d.databaseName}`],
    restore: (d) => ["sh", "-c", `mysql -u${d.username} -p${d.password} ${d.databaseName}`],
  },
  mongodb: {
    ext: "archive.gz",
    dump: (d) => [
      "sh",
      "-c",
      `mongodump --archive --gzip -u ${d.username} -p ${d.password} --authenticationDatabase admin`,
    ],
    restore: (d) => [
      "sh",
      "-c",
      `mongorestore --archive --gzip --drop -u ${d.username} -p ${d.password} --authenticationDatabase admin`,
    ],
  },
  redis: {
    ext: "rdb",
    dump: (d) => ["sh", "-c", `redis-cli -a ${d.password} --no-auth-warning --rdb /tmp/dump.rdb >/dev/null 2>&1 && cat /tmp/dump.rdb`],
    restore: (d) => ["sh", "-c", `cat > /data/dump.rdb`],
  },
};

/** Resolve the directory backups are written to for a given database. */
function backupDirFor(database: { id: string; backupDir?: string | null }): string {
  return database.backupDir || path.join(BACKUP_ROOT, database.id);
}

export class DatabaseBackupService {
  /**
   * Create the backup record immediately (so the UI sees "in_progress") and
   * return it. The actual dump runs in {@link runBackup}, invoked by the worker.
   */
  static async triggerBackup(
    databaseId: string,
    backupType: "manual" | "automatic" = "manual",
  ): Promise<typeof databaseBackups.$inferSelect> {
    const [backup] = await db
      .insert(databaseBackups)
      .values({ databaseId, status: "in_progress", backupType, sizeBytes: 0 })
      .returning();
    return backup;
  }

  /** Perform the actual dump for an existing backup record. */
  static async runBackup(backupId: string): Promise<void> {
    const backup = await db.query.databaseBackups.findFirst({
      where: eq(databaseBackups.id, backupId),
    });
    if (!backup) throw new Error(`Backup ${backupId} not found`);

    const database = await db.query.databases.findFirst({
      where: eq(databases.id, backup.databaseId!),
    });
    if (!database) throw new Error(`Database ${backup.databaseId} not found`);

    const spec = ENGINES[database.type];
    if (!spec) throw new Error(`Backups not supported for engine: ${database.type}`);

    try {
      const container = await getAppContainer(database.id);
      if (!container) throw new Error("Database container is not running");

      const result = await execInContainer(container.id, spec.dump(database));
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `dump exited with code ${result.exitCode}`);
      }

      const dir = backupDirFor(database);
      await fs.mkdir(dir, { recursive: true });
      const fileName = `${database.id}-${Date.now()}.${spec.ext}`;
      const filePath = path.join(dir, fileName);
      await fs.writeFile(filePath, result.stdout);

      const retentionDays = database.backupRetentionDays ?? 7;
      const completedAt = new Date();
      const expiresAt = new Date(completedAt.getTime() + retentionDays * 86400_000);

      await db
        .update(databaseBackups)
        .set({
          status: "completed",
          sizeBytes: result.stdout.length,
          filePath,
          completedAt,
          expiresAt,
        })
        .where(eq(databaseBackups.id, backupId));

      logger.info(`Backup ${backupId} completed (${result.stdout.length} bytes) -> ${filePath}`);
    } catch (err: any) {
      logger.error(`Backup ${backupId} failed: ${err.message}`);
      await db
        .update(databaseBackups)
        .set({ status: "failed", error: err.message, completedAt: new Date() })
        .where(eq(databaseBackups.id, backupId));
      throw err;
    }
  }

  /** Restore a database from a completed backup. */
  static async restoreBackup(backupId: string): Promise<boolean> {
    const backup = await db.query.databaseBackups.findFirst({
      where: eq(databaseBackups.id, backupId),
    });
    if (!backup || backup.status !== "completed" || !backup.filePath) {
      throw new Error("Backup is not ready for restore");
    }

    const database = await db.query.databases.findFirst({
      where: eq(databases.id, backup.databaseId!),
    });
    if (!database) throw new Error("Database not found");

    const spec = ENGINES[database.type];
    if (!spec) throw new Error(`Restore not supported for engine: ${database.type}`);

    const container = await getAppContainer(database.id);
    if (!container) throw new Error("Database container is not running");

    const data = await fs.readFile(backup.filePath);
    const result = await execInContainer(container.id, spec.restore(database), { stdin: data });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `restore exited with code ${result.exitCode}`);
    }

    // Redis loads its RDB on restart.
    if (database.type === "redis") {
      await container.restart({ t: 10 });
    }

    logger.info(`Restored database ${database.id} from backup ${backupId}`);
    return true;
  }

  /** Return the absolute path of a completed backup file for streaming. */
  static async getDownloadFile(
    backupId: string,
  ): Promise<{ filePath: string; fileName: string }> {
    const backup = await db.query.databaseBackups.findFirst({
      where: eq(databaseBackups.id, backupId),
    });
    if (!backup || !backup.filePath || backup.status !== "completed") {
      throw new Error("Backup file not available");
    }
    await fs.access(backup.filePath);
    return { filePath: backup.filePath, fileName: path.basename(backup.filePath) };
  }

  /** Delete a backup's file from disk (best-effort). */
  static async deleteBackupFile(filePath?: string | null): Promise<void> {
    if (!filePath) return;
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") logger.warn(`Failed to delete backup file ${filePath}: ${err.message}`);
    }
  }
}
