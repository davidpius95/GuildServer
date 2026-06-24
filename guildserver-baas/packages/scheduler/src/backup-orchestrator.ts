import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, mkdirSync, statSync, unlinkSync } from "fs";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
import { db, baasProjects, baasBackups } from "@guildserver/baas-db";
import { eq, and, lt } from "drizzle-orm";
import postgres from "postgres";

const execFileAsync = promisify(execFile);

const PG_HOST     = process.env.BAAS_PG_HOST         ?? "localhost";
const PG_PORT     = process.env.BAAS_PG_PORT          ?? "5432";
const PG_ADMIN    = process.env.BAAS_PG_ADMIN_USER    ?? "postgres";
const PG_PASS     = process.env.BAAS_PG_ADMIN_PASSWORD ?? "";
const BACKUP_DIR  = process.env.BAAS_BACKUP_DIR       ?? "/opt/baas-backups";

function backupPath(slug: string, timestamp: string): string {
  return `${BACKUP_DIR}/${slug}/${timestamp}.dump.gz`;
}

export async function createBackup(
  projectId: string,
  backupType: "manual" | "automatic" = "automatic",
): Promise<string> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project) throw new Error("Project not found");

  const timestamp  = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath   = backupPath(project.slug, timestamp);
  const retentionMs = (project.backupRetentionDays ?? 7) * 24 * 60 * 60 * 1000;
  const expiresAt  = new Date(Date.now() + retentionMs);

  const [record] = await db.insert(baasBackups).values({
    projectId,
    backupType,
    status:   "in_progress",
    filePath,
    expiresAt,
  }).returning({ id: baasBackups.id });

  try {
    mkdirSync(`${BACKUP_DIR}/${project.slug}`, { recursive: true });

    // pg_dump → gzip → file (streaming, no temp file)
    await new Promise<void>((resolve, reject) => {
      const dump = spawn("pg_dump", [
        "-h", PG_HOST,
        "-p", PG_PORT,
        "-U", project.dbUser,
        "-d", project.dbName,
        "-F", "c",  // custom format (already compressed)
      ], {
        env: { ...process.env, PGPASSWORD: project.dbPassword ?? PG_PASS },
      });

      const out = createWriteStream(filePath);
      dump.stdout.pipe(out);

      let stderr = "";
      dump.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      dump.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump exited ${code}: ${stderr}`));
      });
    });

    const sizeBytes = statSync(filePath).size;

    await db.update(baasBackups)
      .set({ status: "completed", completedAt: new Date(), sizeBytes })
      .where(eq(baasBackups.id, record.id));
  } catch (err) {
    await db.update(baasBackups)
      .set({ status: "failed", error: String(err) })
      .where(eq(baasBackups.id, record.id));
    throw err;
  }

  return record.id;
}

export async function restoreBackup(backupId: string): Promise<void> {
  const [backup] = await db.select().from(baasBackups).where(eq(baasBackups.id, backupId));
  if (!backup?.filePath) throw new Error("Backup not found or has no file");

  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, backup.projectId));
  if (!project) throw new Error("Project not found");

  const admin = postgres({
    host: PG_HOST, port: parseInt(PG_PORT),
    username: PG_ADMIN, password: PG_PASS, database: "postgres", max: 2,
  });

  try {
    // Terminate connections and drop/recreate the database
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${project.dbName}' AND pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${project.dbName}"`);
    await admin.unsafe(`CREATE DATABASE "${project.dbName}" OWNER "${project.dbUser}"`);
  } finally {
    await admin.end();
  }

  // pg_restore the backup
  await execFileAsync("pg_restore", [
    "-h", PG_HOST,
    "-p", PG_PORT,
    "-U", project.dbUser,
    "-d", project.dbName,
    "--no-owner",
    "--no-privileges",
    backup.filePath,
  ], {
    env: { ...process.env, PGPASSWORD: project.dbPassword ?? PG_PASS },
  });
}

// PITR is not supported in the shared-postgres model (no per-tenant WAL).
// Raise a clear error so callers know to use snapshot restore instead.
export async function restoreToPointInTime(_projectId: string, _targetTime: Date): Promise<void> {
  throw new Error(
    "Point-in-time restore is not available in the shared-platform model. " +
    "Use restoreBackup() with the nearest snapshot instead.",
  );
}

export async function sweepExpiredBackups(): Promise<void> {
  const expired = await db
    .select()
    .from(baasBackups)
    .where(and(lt(baasBackups.expiresAt, new Date()), eq(baasBackups.status, "completed")));

  for (const backup of expired) {
    if (backup.filePath) {
      try { unlinkSync(backup.filePath); } catch {}
    }
    await db.delete(baasBackups).where(eq(baasBackups.id, backup.id));
  }
}
