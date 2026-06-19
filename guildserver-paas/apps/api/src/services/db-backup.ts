import { db } from "@guildserver/database";
import { databaseBackups, databases } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { createGzip, createGunzip } from "zlib";
import { createWriteStream, createReadStream, promises as fs } from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { getAppContainer } from "./docker/container";
import { logger } from "../utils/logger";

const BACKUP_DIR = process.env.BACKUP_DIR || "/app/data/backups";

function backupFilePath(backupId: string): string {
  return path.join(BACKUP_DIR, `${backupId}.dump.gz`);
}

/** Build the shell dump command per engine. Returns null if unsupported. */
function dumpCommand(type: string, dbName: string, user: string, pass: string): string[] | null {
  switch (type) {
    case "postgresql":
      return ["sh", "-c", `PGPASSWORD='${pass}' pg_dump -U '${user}' -d '${dbName}'`];
    case "mysql":
    case "mariadb":
      return ["sh", "-c", `mysqldump -u '${user}' -p'${pass}' '${dbName}'`];
    case "mongodb":
      return ["sh", "-c", `mongodump --username '${user}' --password '${pass}' --authenticationDatabase admin --db '${dbName}' --archive`];
    default:
      return null; // redis and others not supported yet
  }
}

function restoreCommand(type: string, dbName: string, user: string, pass: string): string[] | null {
  switch (type) {
    case "postgresql":
      return ["sh", "-c", `PGPASSWORD='${pass}' psql -U '${user}' -d '${dbName}'`];
    case "mysql":
    case "mariadb":
      return ["sh", "-c", `mysql -u '${user}' -p'${pass}' '${dbName}'`];
    case "mongodb":
      return ["sh", "-c", `mongorestore --username '${user}' --password '${pass}' --authenticationDatabase admin --archive --drop`];
    default:
      return null;
  }
}

export class DatabaseBackupService {
  /** Run a real dump inside the DB container, gzip it to disk, and record it. */
  static async triggerBackup(databaseId: string): Promise<any> {
    const database = await db.query.databases.findFirst({ where: eq(databases.id, databaseId) });
    if (!database) throw new Error("Database not found");

    const cmd = dumpCommand(database.type, database.databaseName, database.username, database.password);
    if (!cmd) throw new Error(`Backups are not supported for ${database.type} yet`);

    const container = await getAppContainer(databaseId);
    if (!container) throw new Error("Database container is not running");

    const [backup] = await db
      .insert(databaseBackups)
      .values({ databaseId, status: "in_progress", sizeBytes: 0 })
      .returning();

    // Run the dump asynchronously; the UI polls via listBackups.
    (async () => {
      try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        const filePath = backupFilePath(backup.id);

        const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
        const stream = await exec.start({});

        const gzip = createGzip();
        const fileStream = createWriteStream(filePath);
        const gzipDone = new Promise<void>((resolve, reject) => {
          fileStream.on("finish", () => resolve());
          fileStream.on("error", reject);
          gzip.on("error", reject);
        });
        gzip.pipe(fileStream);

        // Demux docker multiplexed stream: stdout → gzip, stderr → buffer
        const stderrChunks: Buffer[] = [];
        const stderrSink = { write: (c: Buffer) => { stderrChunks.push(Buffer.from(c)); return true; }, end: () => {} } as any;
        (container as any).modem.demuxStream(stream, gzip, stderrSink);

        await new Promise<void>((resolve, reject) => {
          stream.on("end", () => resolve());
          stream.on("error", reject);
        });
        gzip.end();
        await gzipDone;

        const execInfo = await exec.inspect();
        const stat = await fs.stat(filePath);
        if (execInfo.ExitCode && execInfo.ExitCode !== 0) {
          throw new Error(`dump exited ${execInfo.ExitCode}: ${Buffer.concat(stderrChunks).toString().slice(0, 500)}`);
        }

        await db
          .update(databaseBackups)
          .set({ status: "completed", sizeBytes: stat.size, fileUrl: filePath, completedAt: new Date() })
          .where(eq(databaseBackups.id, backup.id));
        logger.info(`Backup ${backup.id} completed (${stat.size} bytes)`);
      } catch (err: any) {
        logger.error(`Backup ${backup.id} failed: ${err.message}`);
        await db
          .update(databaseBackups)
          .set({ status: "failed", completedAt: new Date() })
          .where(eq(databaseBackups.id, backup.id));
      }
    })();

    return backup;
  }

  /** Restore a completed backup by streaming the dump back into the container. */
  static async restoreBackup(backupId: string): Promise<boolean> {
    const backup = await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, backupId) });
    if (!backup || backup.status !== "completed" || !backup.fileUrl) {
      throw new Error("Backup is not ready for restore");
    }
    const database = await db.query.databases.findFirst({ where: eq(databases.id, backup.databaseId!) });
    if (!database) throw new Error("Database not found");

    const cmd = restoreCommand(database.type, database.databaseName, database.username, database.password);
    if (!cmd) throw new Error(`Restore is not supported for ${database.type} yet`);

    const container = await getAppContainer(backup.databaseId!);
    if (!container) throw new Error("Database container is not running");

    const exec = await container.exec({ Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: true });

    await new Promise<void>((resolve, reject) => {
      const src = createReadStream(backup.fileUrl!).pipe(createGunzip());
      src.on("error", reject);
      src.pipe(stream as any);
      src.on("end", () => { try { (stream as any).end(); } catch { /* noop */ } });
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });

    const info = await exec.inspect();
    if (info.ExitCode && info.ExitCode !== 0) {
      throw new Error(`restore exited with code ${info.ExitCode}`);
    }
    return true;
  }

  /** Generate a short-lived signed download URL handled by the /backups route. */
  static async getDownloadUrl(backupId: string): Promise<string> {
    const backup = await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, backupId) });
    if (!backup || backup.status !== "completed" || !backup.fileUrl) {
      throw new Error("Backup file not found");
    }
    const token = jwt.sign({ backupId }, process.env.JWT_SECRET!, { expiresIn: "1h" });
    const base = process.env.API_URL || process.env.API_PUBLIC_URL || "";
    return `${base}/backups/${backupId}?token=${token}`;
  }

  /** Resolve the on-disk path for a backup id (used by the download route). */
  static async getFilePath(backupId: string): Promise<string | null> {
    const backup = await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, backupId) });
    return backup?.fileUrl ?? null;
  }
}
