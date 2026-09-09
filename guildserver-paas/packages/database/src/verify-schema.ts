/**
 * db:verify — compares the live database schema against what
 * `schema/index.ts` declares, and exits non-zero on drift.
 *
 * This exists because the exact bug this package fixes (a column declared
 * in schema/index.ts silently missing from a freshly migrated database)
 * was only discoverable by manual inspection before now. Wiring this into
 * CI turns that class of bug into a build failure instead of a customer
 * incident.
 *
 * Checks performed, per table exported from schema/index.ts:
 *  - the table exists in the database
 *  - every column drizzle declares exists in the database
 *  - nullability (NOT NULL) matches
 * Columns that exist in the database but are NOT declared in the schema
 * are reported as informational only (not treated as failing drift) since
 * a table may legitimately carry operational columns the ORM layer never
 * needs to touch.
 */
import postgres from "postgres";
import * as path from "path";
import * as dotenv from "dotenv";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema";

interface ColumnDrift {
  table: string;
  column: string;
  kind: "missing_column" | "nullability_mismatch";
  detail: string;
}

interface TableInfo {
  columns: Map<string, { isNullable: boolean; dataType: string }>;
}

async function loadLiveSchema(sql: postgres.Sql): Promise<{
  tables: Set<string>;
  columnsByTable: Map<string, TableInfo>;
}> {
  const tableRows = await sql.unsafe<{ table_name: string }[]>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const tables = new Set(tableRows.map((r: any) => r.table_name));

  const columnRows = await sql.unsafe<
    { table_name: string; column_name: string; is_nullable: string; data_type: string }[]
  >(`
    SELECT table_name, column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  const columnsByTable = new Map<string, TableInfo>();
  for (const row of columnRows as any[]) {
    if (!columnsByTable.has(row.table_name)) {
      columnsByTable.set(row.table_name, { columns: new Map() });
    }
    columnsByTable.get(row.table_name)!.columns.set(row.column_name, {
      isNullable: row.is_nullable === "YES",
      dataType: row.data_type,
    });
  }

  return { tables, columnsByTable };
}

function collectSchemaTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      tables.push(value as PgTable);
    }
  }
  return tables;
}

export async function verifySchema(sql: postgres.Sql): Promise<ColumnDrift[]> {
  const { tables: liveTables, columnsByTable } = await loadLiveSchema(sql);
  const drifts: ColumnDrift[] = [];

  for (const table of collectSchemaTables()) {
    const config = getTableConfig(table);
    const tableName = config.name;

    if (!liveTables.has(tableName)) {
      drifts.push({
        table: tableName,
        column: "*",
        kind: "missing_column",
        detail: `table "${tableName}" declared in schema/index.ts does not exist in the database`,
      });
      continue;
    }

    const liveColumns = columnsByTable.get(tableName)?.columns ?? new Map();

    for (const column of config.columns) {
      const live = liveColumns.get(column.name);
      if (!live) {
        drifts.push({
          table: tableName,
          column: column.name,
          kind: "missing_column",
          detail: `column "${tableName}.${column.name}" declared in schema/index.ts is missing from the database`,
        });
        continue;
      }

      const expectedNullable = !column.notNull;
      if (live.isNullable !== expectedNullable) {
        drifts.push({
          table: tableName,
          column: column.name,
          kind: "nullability_mismatch",
          detail: `column "${tableName}.${column.name}" expected ${
            expectedNullable ? "nullable" : "NOT NULL"
          } but database has ${live.isNullable ? "nullable" : "NOT NULL"}`,
        });
      }
    }
  }

  return drifts;
}

async function main() {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
  const connectionString = process.env.DATABASE_URL!;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const sql = postgres(connectionString, { max: 1 });
  try {
    const drifts = await verifySchema(sql);
    if (drifts.length === 0) {
      console.log("Schema verification passed: database matches schema/index.ts.");
      return;
    }

    console.error(`Schema drift detected: ${drifts.length} issue(s).`);
    for (const d of drifts) {
      console.error(`  [${d.kind}] ${d.detail}`);
    }
    process.exitCode = 1;
  } catch (error) {
    console.error("Schema verification failed to run:", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main();
}
