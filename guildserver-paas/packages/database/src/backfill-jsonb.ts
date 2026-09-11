/**
 * Convert jsonb values stored as JSON strings back into real JSON.
 * See src/jsonb-backfill.ts for why they exist.
 *
 * Usage (dry run by default — prints what would change):
 *   tsx src/backfill-jsonb.ts
 *   tsx src/backfill-jsonb.ts --apply [--only metrics.labels] [--batch-size 5000] [--pause-ms 50]
 */
import postgres from "postgres";
import * as path from "path";
import * as dotenv from "dotenv";
import { backfillColumn, listJsonbColumns, reportColumn } from "./jsonb-backfill";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is required");

  const apply = process.argv.includes("--apply");
  const only = flag("only");
  const batchSize = Number(flag("batch-size") ?? 5000);
  const pauseMs = Number(flag("pause-ms") ?? 0);

  const sql = postgres(connectionString, { max: 1 });
  try {
    let columns = await listJsonbColumns(sql);
    if (only) columns = columns.filter((c) => `${c.table}.${c.column}` === only);

    let total = 0;
    for (const column of columns) {
      const report = await reportColumn(sql, column);
      if (report.convertible === 0 && report.otherStrings === 0) continue;
      const name = `${column.table}.${column.column}`;
      console.log(
        `${name}: ${report.convertible} to convert` +
          (report.otherStrings ? `, ${report.otherStrings} plain string(s) left as they are` : ""),
      );
      if (!apply || report.convertible === 0) continue;

      let lastLog = Date.now();
      const converted = await backfillColumn(sql, column, {
        batchSize,
        pauseMs,
        onBatch: ({ scanned, converted: soFar }) => {
          if (Date.now() - lastLog > 10_000) {
            console.log(`  ${name}: scanned ${scanned}, converted ${soFar}`);
            lastLog = Date.now();
          }
        },
      });
      console.log(`  ${name}: converted ${converted}`);
      total += converted;
    }

    console.log(apply ? `Done: converted ${total} value(s).` : "Dry run: nothing changed. Re-run with --apply.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
