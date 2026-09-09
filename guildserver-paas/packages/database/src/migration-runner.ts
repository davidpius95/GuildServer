import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type postgres from "postgres";
import { MIGRATIONS, type MigrationManifestEntry } from "./migrations-manifest";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const TRACKING_TABLE = "guildserver_migrations";

export type ApplyMethod = "executed" | "baseline" | "reconciled";

export interface TrackingRow {
  id: string;
  applied_at: Date;
  method: ApplyMethod;
  checksum: string;
}

/** Split a drizzle-style SQL file on its `--> statement-breakpoint` markers. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function checksumOf(sql: string): string {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function readMigrationFile(entry: MigrationManifestEntry): string {
  const filePath = path.join(MIGRATIONS_DIR, entry.file);
  return fs.readFileSync(filePath, "utf8");
}

export async function ensureTrackingTable(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${TRACKING_TABLE}" (
      "id" text PRIMARY KEY,
      "applied_at" timestamptz NOT NULL DEFAULT now(),
      "method" text NOT NULL,
      "checksum" text NOT NULL
    );
  `);
}

export async function getAppliedIds(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql.unsafe<TrackingRow[]>(`SELECT id FROM "${TRACKING_TABLE}"`);
  return new Set(rows.map((r: any) => r.id));
}

/**
 * Reconcile against drizzle-orm's own `drizzle.__drizzle_migrations` table.
 *
 * drizzle's migrator records one row per applied journal entry, in journal
 * order, keyed by a sha256 hash of the raw file content at the time it ran
 * (not by name). We do NOT hash-match here on purpose: this repo's drizzle
 * SQL files have since been edited (to add idempotency guards), which
 * changes their hash. Instead we rely on the fact that drizzle always
 * applies journal entries strictly in order starting from the first —
 * so if `drizzle.__drizzle_migrations` has N rows, the first N entries of
 * the journal (== the first N "drizzle" entries in our manifest, since our
 * manifest lists them in journal order) are known to have been applied
 * for real, via drizzle's own migrate(), and must be marked as already
 * satisfied without re-running their SQL.
 */
export async function reconcileDrizzleHistory(sql: postgres.Sql): Promise<string[]> {
  const hasDrizzleTable = await sql.unsafe<{ exists: boolean }[]>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) AS exists;
  `);
  if (!hasDrizzleTable[0]?.exists) {
    return [];
  }

  const rows = await sql.unsafe<{ count: string }[]>(
    `SELECT count(*)::text AS count FROM "drizzle"."__drizzle_migrations"`
  );
  const appliedCount = parseInt(rows[0]?.count ?? "0", 10);
  if (appliedCount <= 0) return [];

  const drizzleEntries = MIGRATIONS.filter((m) => m.family === "drizzle");
  const toReconcile = drizzleEntries.slice(0, appliedCount);

  const reconciled: string[] = [];
  for (const entry of toReconcile) {
    const sqlText = readMigrationFile(entry);
    await sql.unsafe(
      `INSERT INTO "${TRACKING_TABLE}" (id, method, checksum) VALUES ($1, 'reconciled', $2)
       ON CONFLICT (id) DO NOTHING`,
      [entry.id, checksumOf(sqlText)]
    );
    reconciled.push(entry.id);
  }
  return reconciled;
}

export interface ApplyResult {
  id: string;
  status: "skipped" | "executed";
}

/** Apply every migration in manifest order that isn't already tracked. */
export async function applyPending(sql: postgres.Sql): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  const applied = await getAppliedIds(sql);

  for (const entry of MIGRATIONS) {
    if (applied.has(entry.id)) {
      results.push({ id: entry.id, status: "skipped" });
      continue;
    }

    const sqlText = readMigrationFile(entry);
    const statements = splitStatements(sqlText);

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx.unsafe(
        `INSERT INTO "${TRACKING_TABLE}" (id, method, checksum) VALUES ($1, 'executed', $2)
         ON CONFLICT (id) DO NOTHING`,
        [entry.id, checksumOf(sqlText)]
      );
    });

    results.push({ id: entry.id, status: "executed" });
  }

  return results;
}

/**
 * Mark migrations as applied WITHOUT executing their SQL. Used to baseline
 * an existing database (e.g. production) where the DDL was already run by
 * hand at some point in the past, outside of any tracked migration tool.
 *
 * Refuses to baseline an id that isn't in the manifest, and is a no-op
 * (does not overwrite) for an id that is already tracked by any method.
 */
export async function baselineMigrations(
  sql: postgres.Sql,
  ids: string[]
): Promise<{ baselined: string[]; alreadyTracked: string[] }> {
  const applied = await getAppliedIds(sql);
  const baselined: string[] = [];
  const alreadyTracked: string[] = [];

  for (const id of ids) {
    const entry = MIGRATIONS.find((m) => m.id === id);
    if (!entry) {
      throw new Error(`Unknown migration id "${id}" — not present in migrations-manifest.ts`);
    }
    if (applied.has(id)) {
      alreadyTracked.push(id);
      continue;
    }
    const sqlText = readMigrationFile(entry);
    await sql.unsafe(
      `INSERT INTO "${TRACKING_TABLE}" (id, method, checksum) VALUES ($1, 'baseline', $2)
       ON CONFLICT (id) DO NOTHING`,
      [id, checksumOf(sqlText)]
    );
    baselined.push(id);
  }

  return { baselined, alreadyTracked };
}

export function allHandMigrationIds(): string[] {
  return MIGRATIONS.filter((m) => m.family === "hand").map((m) => m.id);
}

export function allMigrationIds(): string[] {
  return MIGRATIONS.map((m) => m.id);
}

export { TRACKING_TABLE, MIGRATIONS_DIR, splitStatements, checksumOf, MIGRATIONS };
export type { MigrationManifestEntry };
