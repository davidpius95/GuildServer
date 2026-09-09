import postgres from "postgres";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  ensureTrackingTable,
  reconcileDrizzleHistory,
  applyPending,
} from "./migration-runner";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const connectionString = process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = postgres(connectionString, { max: 1 });

async function main() {
  console.log("Running database migrations...");

  try {
    await ensureTrackingTable(sql);

    const reconciled = await reconcileDrizzleHistory(sql);
    if (reconciled.length > 0) {
      console.log(
        `Reconciled ${reconciled.length} migration(s) already applied via drizzle's own history: ${reconciled.join(", ")}`
      );
    }

    const results = await applyPending(sql);
    const executed = results.filter((r) => r.status === "executed");
    const skipped = results.filter((r) => r.status === "skipped");

    for (const r of executed) {
      console.log(`  applied: ${r.id}`);
    }
    console.log(
      `Migrations complete: ${executed.length} applied, ${skipped.length} already up to date (of ${results.length} total).`
    );
  } catch (error) {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
