import { createHash, randomUUID } from "crypto";
import { createReadStream, createWriteStream, promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { eq } from "drizzle-orm";
import { db, databaseBackups, databases, projects, s3Storages } from "@guildserver/database";
import { getAppContainer, streamExecInContainer } from "./docker/container";
import { configFromRow, deleteObject, describeStorageError, downloadToFile, objectKey, uploadFile } from "./storage/s3";
import { waitForEngineReady } from "./database-readiness";
import { logger } from "../utils/logger";

/** Root directory for backup files; overridable via env. */
const BACKUP_ROOT = process.env.BACKUP_DIR || "/var/lib/guildserver/backups";

type Credentials = { databaseName: string; username: string; password: string };

/** A command to run inside the database container, with secrets carried in env. */
export interface EngineCommand {
  cmd: string[];
  env: string[];
}

interface EngineSpec {
  ext: string;
  dump: (d: Credentials) => EngineCommand;
  restore: (d: Credentials) => EngineCommand;
}

/**
 * Names that are passed to a client as a positional argument must not be able
 * to look like an option ("--result-file=/…"). Refusing an unusual name is
 * better than running a dump that does something else.
 */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_.$-]{0,127}$/;

function requireSafeIdentifier(kind: string, value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Backups are not supported for this ${kind}: it contains characters that cannot be passed safely`);
  }
  return value;
}

/**
 * Credentials never appear in a command string.
 *
 * The previous commands interpolated the username and password into `sh -c`,
 * e.g. `mysqldump -u${username} -p${password} …`. Both come straight from the
 * user when a database is created, so a password such as `$(…)` ran arbitrary
 * commands inside the database container every time it was backed up, and the
 * password was visible in the container's process list. Values now travel as
 * environment variables; where a shell is still needed it only ever references
 * them as quoted "$VARIABLES", which the shell expands without re-parsing.
 */
export const ENGINES: Record<string, EngineSpec> = {
  postgresql: {
    ext: "dump",
    // --opt=value form: a value can never become a separate option.
    dump: (d) => ({
      cmd: ["pg_dump", `--username=${d.username}`, "--format=custom", `--dbname=${d.databaseName}`],
      env: [`PGPASSWORD=${d.password}`],
    }),
    restore: (d) => ({
      cmd: ["pg_restore", `--username=${d.username}`, `--dbname=${d.databaseName}`, "--clean", "--if-exists"],
      env: [`PGPASSWORD=${d.password}`],
    }),
  },
  mysql: {
    ext: "sql",
    dump: (d) => ({
      cmd: ["mysqldump", `--user=${d.username}`, "--single-transaction", requireSafeIdentifier("database name", d.databaseName)],
      env: [`MYSQL_PWD=${d.password}`],
    }),
    restore: (d) => ({
      cmd: ["mysql", `--user=${d.username}`, requireSafeIdentifier("database name", d.databaseName)],
      env: [`MYSQL_PWD=${d.password}`],
    }),
  },
  mariadb: {
    ext: "sql",
    dump: (d) => ({
      cmd: ["mysqldump", `--user=${d.username}`, "--single-transaction", requireSafeIdentifier("database name", d.databaseName)],
      env: [`MYSQL_PWD=${d.password}`],
    }),
    restore: (d) => ({
      cmd: ["mysql", `--user=${d.username}`, requireSafeIdentifier("database name", d.databaseName)],
      env: [`MYSQL_PWD=${d.password}`],
    }),
  },
  mongodb: {
    ext: "archive.gz",
    // mongodump has no password environment variable; the shell expands the
    // quoted variables into single arguments without interpreting their content.
    dump: (d) => ({
      cmd: ["sh", "-c", 'exec mongodump --archive --gzip --username="$GS_DB_USER" --password="$GS_DB_PASSWORD" --authenticationDatabase=admin'],
      env: [`GS_DB_USER=${d.username}`, `GS_DB_PASSWORD=${d.password}`],
    }),
    restore: (d) => ({
      cmd: ["sh", "-c", 'exec mongorestore --archive --gzip --drop --username="$GS_DB_USER" --password="$GS_DB_PASSWORD" --authenticationDatabase=admin'],
      env: [`GS_DB_USER=${d.username}`, `GS_DB_PASSWORD=${d.password}`],
    }),
  },
  redis: {
    ext: "rdb",
    // redis-cli reads REDISCLI_AUTH, so the script contains no user value at all.
    dump: (d) => ({
      cmd: ["sh", "-c", "redis-cli --no-auth-warning --rdb /tmp/gs-dump.rdb >/dev/null && cat /tmp/gs-dump.rdb && rm -f /tmp/gs-dump.rdb"],
      env: [`REDISCLI_AUTH=${d.password}`],
    }),
    restore: () => ({ cmd: ["sh", "-c", "cat > /data/dump.rdb"], env: [] }),
  },
};

/**
 * Where a database's backups are written.
 *
 * backup_dir used to be accepted from the API and used as-is, which let a user
 * make the platform write dump files into any directory the API process could
 * reach. Only a directory inside BACKUP_ROOT is honoured now; anything else
 * falls back to the default.
 */
export function backupDirFor(database: { id: string; backupDir?: string | null }): string {
  const fallback = path.join(BACKUP_ROOT, database.id);
  if (!database.backupDir) return fallback;
  const resolved = path.resolve(database.backupDir);
  const root = path.resolve(BACKUP_ROOT) + path.sep;
  return resolved.startsWith(root) ? resolved : fallback;
}

async function fileExists(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), async function* (source) {
    for await (const chunk of source) hash.update(chunk as Buffer);
  });
  return hash.digest("hex");
}

async function organizationOfDatabase(database: { projectId: string | null }): Promise<string | null> {
  if (!database.projectId) return null;
  const [row] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, database.projectId))
    .limit(1);
  return row?.organizationId ?? null;
}

/** The storage row, but only if it belongs to the same organization as the database. */
async function storageForDatabase(storageId: string, database: { projectId: string | null }) {
  const storage = await db.query.s3Storages.findFirst({ where: eq(s3Storages.id, storageId) });
  if (!storage) return null;
  const organizationId = await organizationOfDatabase(database);
  return organizationId && storage.organizationId === organizationId ? storage : null;
}

/** Tell the database's organization that a backup needs attention. Never throws. */
async function notifyBackupProblem(
  event: "backup_failed" | "backup_upload_failed",
  database: { id: string; name: string; projectId: string | null },
  backupId: string,
  error: string,
): Promise<void> {
  try {
    const organizationId = await organizationOfDatabase(database);
    if (!organizationId) return;
    // Loaded lazily: the notification service pulls in the WebSocket server,
    // which the backup code should not depend on at import time.
    const { notifyOrganization } = await import("./notification");
    notifyOrganization(organizationId, event, {
      databaseName: database.name,
      error,
      url: `${process.env.APP_URL || "http://localhost:3000"}/dashboard/databases`,
      dedupeKey: backupId,
    }).catch((notifyError: any) => logger.warn(`${event} notification for backup ${backupId} failed: ${notifyError?.message}`));
  } catch (notifyError: any) {
    logger.warn(`Could not send ${event} notification for backup ${backupId}: ${notifyError?.message}`);
  }
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

  /**
   * Dump the database to a local file, streaming, while computing its SHA-256;
   * then, if the database has an off-site storage configured, copy it there.
   *
   * The dump is never held in memory. A failed off-site copy does not fail the
   * backup — the local copy is complete and verified — but it is recorded.
   */
  static async runBackup(
    backupId: string,
    options: { waitForReady?: typeof waitForEngineReady } = {},
  ): Promise<void> {
    const backup = await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, backupId) });
    if (!backup) throw new Error(`Backup ${backupId} not found`);

    const database = await db.query.databases.findFirst({ where: eq(databases.id, backup.databaseId!) });
    if (!database) throw new Error(`Database ${backup.databaseId} not found`);

    const spec = ENGINES[database.type];
    if (!spec) throw new Error(`Backups not supported for engine: ${database.type}`);

    let filePath: string | null = null;
    try {
      const container = await getAppContainer(database.id);
      if (!container) throw new Error("Database container is not running");

      // A backup taken seconds after creation used to fail with "database does
      // not exist" because the engine was still initialising. Waiting briefly
      // turns that into a retry (the queue retries) instead of a failed backup.
      const waitReady = options.waitForReady ?? waitForEngineReady;
      const ready = await waitReady(container.id, database.type, database, { timeoutMs: 60_000 });
      if (!ready) throw new Error("Database engine is not ready yet; the backup will be retried.");

      const command = spec.dump(database);
      const dir = backupDirFor(database);
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      filePath = path.join(dir, `${database.id}-${Date.now()}.${spec.ext}`);

      const hash = createHash("sha256");
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          size += chunk.length;
          callback(null, chunk);
        },
      });

      const { stdout, completed } = await streamExecInContainer(container.id, command.cmd, { env: command.env });
      const [, result] = await Promise.all([pipeline(stdout, meter, createWriteStream(filePath, { mode: 0o600 })), completed]);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().slice(-2000) || `dump exited with code ${result.exitCode}`);
      }
      if (size === 0) throw new Error("dump produced no output");

      const retentionDays = database.backupRetentionDays ?? 7;
      const completedAt = new Date();
      await db
        .update(databaseBackups)
        .set({
          status: "completed",
          sizeBytes: size,
          filePath,
          checksumSha256: hash.digest("hex"),
          completedAt,
          expiresAt: new Date(completedAt.getTime() + retentionDays * 86400_000),
        })
        .where(eq(databaseBackups.id, backupId));

      logger.info(`Backup ${backupId} completed (${size} bytes) -> ${filePath}`);
    } catch (err: any) {
      logger.error(`Backup ${backupId} failed: ${err.message}`);
      if (filePath) await fsp.rm(filePath, { force: true }).catch(() => undefined);
      await db
        .update(databaseBackups)
        .set({ status: "failed", error: err.message, completedAt: new Date() })
        .where(eq(databaseBackups.id, backupId));
      await notifyBackupProblem("backup_failed", database, backupId, err.message);
      throw err;
    }

    if (database.backupStorageId) {
      await DatabaseBackupService.copyOffsite(backupId);
    }
  }

  /** Upload a completed local backup to its database's off-site storage. */
  static async copyOffsite(backupId: string): Promise<boolean> {
    const backup = await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, backupId) });
    if (!backup?.filePath || backup.status !== "completed") return false;
    const database = await db.query.databases.findFirst({ where: eq(databases.id, backup.databaseId!) });
    if (!database?.backupStorageId) return false;

    const storage = await storageForDatabase(database.backupStorageId, database);
    if (!storage) {
      await db
        .update(databaseBackups)
        .set({ uploadError: "The configured backup storage no longer exists or belongs to another organization" })
        .where(eq(databaseBackups.id, backupId));
      await notifyBackupProblem("backup_upload_failed", database, backupId, "The configured backup storage no longer exists or belongs to another organization");
      return false;
    }

    try {
      const cfg = configFromRow(storage);
      const key = objectKey(cfg, "database-backups", database.id, path.basename(backup.filePath));
      await uploadFile(cfg, key, backup.filePath);
      await db
        .update(databaseBackups)
        .set({ storageId: storage.id, remoteKey: key, uploadedAt: new Date(), uploadError: null })
        .where(eq(databaseBackups.id, backupId));
      logger.info(`Backup ${backupId} copied off-site to ${storage.bucket}/${key}`);
      return true;
    } catch (error) {
      const message = describeStorageError(error);
      logger.warn(`Off-site copy of backup ${backupId} failed: ${message}`);
      await db.update(databaseBackups).set({ uploadError: message }).where(eq(databaseBackups.id, backupId));
      await notifyBackupProblem("backup_upload_failed", database, backupId, message);
      return false;
    }
  }

  /**
   * Obtain a verified copy of a backup: the local file if it matches its
   * checksum, otherwise the off-site copy downloaded to a temporary file.
   * `cleanup` removes any temporary file.
   */
  static async obtainVerifiedCopy(
    backup: typeof databaseBackups.$inferSelect,
    database: { projectId: string | null },
  ): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
    const noop = async () => undefined;
    const problems: string[] = [];

    if (await fileExists(backup.filePath)) {
      if (!backup.checksumSha256 || (await sha256File(backup.filePath!)) === backup.checksumSha256) {
        return { filePath: backup.filePath!, cleanup: noop };
      }
      problems.push("the local copy does not match its checksum");
    } else {
      problems.push("there is no local copy");
    }

    if (backup.storageId && backup.remoteKey) {
      const storage = await storageForDatabase(backup.storageId, database);
      if (!storage) {
        problems.push("its off-site storage no longer exists");
      } else {
        const temp = path.join(os.tmpdir(), `gs-backup-${randomUUID()}`);
        const cleanup = () => fsp.rm(temp, { force: true }).then(() => undefined);
        try {
          await downloadToFile(configFromRow(storage), backup.remoteKey, temp);
          if (!backup.checksumSha256 || (await sha256File(temp)) === backup.checksumSha256) {
            return { filePath: temp, cleanup };
          }
          problems.push("the off-site copy does not match its checksum");
        } catch (error) {
          problems.push(`the off-site copy could not be downloaded (${describeStorageError(error)})`);
        }
        await cleanup();
      }
    }

    throw new Error(`Backup is not usable: ${problems.join("; ")}`);
  }

  /** Restore a database from a completed backup, refusing a corrupt or altered file. */
  static async restoreBackup(backupId: string): Promise<boolean> {
    const backup = await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, backupId) });
    if (!backup || backup.status !== "completed") throw new Error("Backup is not ready for restore");

    const database = await db.query.databases.findFirst({ where: eq(databases.id, backup.databaseId!) });
    if (!database) throw new Error("Database not found");

    const spec = ENGINES[database.type];
    if (!spec) throw new Error(`Restore not supported for engine: ${database.type}`);

    const container = await getAppContainer(database.id);
    if (!container) throw new Error("Database container is not running");

    const copy = await DatabaseBackupService.obtainVerifiedCopy(backup, database);
    try {
      const command = spec.restore(database);
      const { stdout, completed } = await streamExecInContainer(container.id, command.cmd, {
        env: command.env,
        stdin: createReadStream(copy.filePath),
      });
      stdout.resume();
      const result = await completed;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().slice(-2000) || `restore exited with code ${result.exitCode}`);
      }
    } finally {
      await copy.cleanup();
    }

    // Redis loads its RDB on restart.
    if (database.type === "redis") {
      await container.restart({ t: 10 });
    }

    logger.info(`Restored database ${database.id} from backup ${backupId}`);
    return true;
  }

  /** A verified file to stream to a user, plus cleanup for any temporary copy. */
  static async getDownloadFile(
    backupId: string,
  ): Promise<{ filePath: string; fileName: string; cleanup: () => Promise<void> }> {
    const backup = await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, backupId) });
    if (!backup || backup.status !== "completed") throw new Error("Backup file not available");
    const database = await db.query.databases.findFirst({ where: eq(databases.id, backup.databaseId!) });
    if (!database) throw new Error("Backup file not available");

    const copy = await DatabaseBackupService.obtainVerifiedCopy(backup, database);
    const fileName = path.basename(backup.filePath || backup.remoteKey || `${backup.id}.backup`);
    return { filePath: copy.filePath, fileName, cleanup: copy.cleanup };
  }

  /** Delete a backup's file from disk (best-effort). */
  static async deleteBackupFile(filePath?: string | null): Promise<void> {
    if (!filePath) return;
    try {
      await fsp.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") logger.warn(`Failed to delete backup file ${filePath}: ${err.message}`);
    }
  }

  /**
   * Remove every copy of a backup. Returns false if an off-site copy could not
   * be deleted, so the caller can keep the record and retry rather than
   * orphaning an object nobody can find again.
   */
  static async deleteBackupArtifacts(backup: typeof databaseBackups.$inferSelect): Promise<boolean> {
    await DatabaseBackupService.deleteBackupFile(backup.filePath);
    if (!backup.storageId || !backup.remoteKey) return true;

    const storage = await db.query.s3Storages.findFirst({ where: eq(s3Storages.id, backup.storageId) });
    if (!storage) return true; // Nothing left that could hold the object.
    try {
      await deleteObject(configFromRow(storage), backup.remoteKey);
      return true;
    } catch (error) {
      logger.warn(`Failed to delete off-site copy of backup ${backup.id}: ${describeStorageError(error)}`);
      return false;
    }
  }
}
