/**
 * One-time operator tool: mark migrations as already applied WITHOUT
 * running their SQL.
 *
 * Use this on a database (e.g. production) where some of the migrations in
 * migrations-manifest.ts were already applied by hand, outside of any
 * migration tool, so re-running their SQL for real would be redundant at
 * best and unsafe at worst (several of the hand-written files were only
 * partially idempotent before this fix, and even now, "safe to replay"
 * was verified for THESE contents, not for whatever hand-run variant
 * production may have actually executed).
 *
 * Usage:
 *   tsx src/migrate-baseline.ts <id> [<id> ...]
 *   tsx src/migrate-baseline.ts --all-hand      # baseline every "hand" family id
 *   tsx src/migrate-baseline.ts --dry-run <id> [<id> ...]   # print, don't write
 *
 * This refuses to baseline an id already tracked (by any method), and
 * refuses an id not present in migrations-manifest.ts. It does not
 * execute any migration SQL.
 */
import postgres from "postgres";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  ensureTrackingTable,
  baselineMigrations,
  allHandMigrationIds,
} from "./migration-runner";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const useAllHand = args.includes("--all-hand");
  const ids = args.filter((a) => a !== "--dry-run" && a !== "--all-hand");

  const targetIds = useAllHand ? allHandMigrationIds() : ids;

  if (targetIds.length === 0) {
    console.error(
      "Usage: tsx src/migrate-baseline.ts <id> [<id> ...] | --all-hand [--dry-run]"
    );
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log("[dry-run] Would baseline the following migration ids (no SQL executed, no rows written):");
    for (const id of targetIds) console.log(`  ${id}`);
    return;
  }

  const sql = postgres(connectionString, { max: 1 });
  try {
    await ensureTrackingTable(sql);
    const { baselined, alreadyTracked } = await baselineMigrations(sql, targetIds);

    if (baselined.length > 0) {
      console.log(`Baselined (marked applied, not executed): ${baselined.join(", ")}`);
    }
    if (alreadyTracked.length > 0) {
      console.log(`Already tracked, left untouched: ${alreadyTracked.join(", ")}`);
    }
  } catch (error) {
    console.error("Baseline failed:", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
