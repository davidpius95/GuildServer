/**
 * Repair jsonb values that were written as JSON *strings*.
 *
 * drizzle-orm before 0.33 serialised jsonb twice when used with postgres-js,
 * so `{"a":1}` was stored as the jsonb string scalar `"{\"a\":1}"`. Drizzle
 * decoded it back on read, which hid the problem, but anything that looks
 * inside the value in SQL (`->`, `@>`, `jsonb_typeof`) silently saw a string.
 * drizzle-orm 0.33 fixed the write path; this converts the rows written before.
 *
 * Only string scalars whose text parses as a JSON object or array are
 * converted, so a value that is genuinely a string is never touched. The
 * update is idempotent and runs in primary-key batches, so it is safe to
 * re-run, to interrupt, and to run while the application is writing.
 */
import type { Sql } from "postgres";

export interface JsonbColumn {
  table: string;
  column: string;
  /** Single-column primary key used for keyset batching, if the table has one. */
  primaryKey: string | null;
}

export interface ColumnReport extends JsonbColumn {
  /** String scalars that hold a JSON object or array: these get converted. */
  convertible: number;
  /** String scalars that are not JSON-shaped: these are left alone. */
  otherStrings: number;
}

/** Every jsonb column in the public schema, with its table's primary key. */
export async function listJsonbColumns(sql: Sql): Promise<JsonbColumn[]> {
  const rows = await sql<{ table: string; column: string; pk: string[] | null }[]>`
    SELECT c.table_name AS "table",
           c.column_name AS "column",
           (
             SELECT array_agg(a.attname ORDER BY a.attnum)
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
               AND i.indisprimary
           ) AS pk
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.data_type = 'jsonb'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.column_name
  `;
  return rows.map((row) => ({
    table: row.table,
    column: row.column,
    primaryKey: row.pk && row.pk.length === 1 ? row.pk[0] : null,
  }));
}

/**
 * Matches the rows to convert: string scalars whose text looks like a JSON
 * object or array. A malformed one still fails the cast, which the batch
 * update handles by retrying that batch row by row (PostgreSQL 15 has no
 * pg_input_is_valid to filter it out up front).
 */
function convertible(sql: Sql, column: string) {
  return sql`
    jsonb_typeof(${sql(column)}) = 'string'
    AND (${sql(column)} #>> '{}') ~ '^\\s*[\\[{]'
  `;
}

/** invalid_text_representation: the string was not valid JSON after all. */
function isInvalidJson(error: unknown): boolean {
  return (error as { code?: string })?.code === "22P02";
}

export async function reportColumn(sql: Sql, col: JsonbColumn): Promise<ColumnReport> {
  const [row] = await sql<{ convertible: string; strings: string }[]>`
    SELECT count(*) FILTER (WHERE ${convertible(sql, col.column)}) AS convertible,
           count(*) FILTER (WHERE jsonb_typeof(${sql(col.column)}) = 'string') AS strings
    FROM ${sql(col.table)}
  `;
  const convertibleCount = Number(row.convertible);
  return { ...col, convertible: convertibleCount, otherStrings: Number(row.strings) - convertibleCount };
}

export interface BackfillOptions {
  batchSize?: number;
  /** Pause between batches so a large table does not starve live traffic. */
  pauseMs?: number;
  onBatch?: (progress: { table: string; column: string; scanned: number; converted: number }) => void;
}

/** Convert one column. Returns the number of rows converted. */
export async function backfillColumn(
  sql: Sql,
  col: JsonbColumn,
  { batchSize = 5000, pauseMs = 0, onBatch }: BackfillOptions = {},
): Promise<number> {
  if (!col.primaryKey) {
    // Only small tables lack a single-column key; convert them in one pass.
    const result = await sql`
      UPDATE ${sql(col.table)} SET ${sql(col.column)} = (${sql(col.column)} #>> '{}')::jsonb
      WHERE ${convertible(sql, col.column)}
    `;
    onBatch?.({ table: col.table, column: col.column, scanned: result.count, converted: result.count });
    return result.count;
  }

  const pk = col.primaryKey;
  let after: string | null = null;
  let scanned = 0;
  let converted = 0;

  for (;;) {
    const keys: { k: string }[] = await sql<{ k: string }[]>`
      SELECT ${sql(pk)}::text AS k FROM ${sql(col.table)}
      ${after === null ? sql`` : sql`WHERE ${sql(pk)} > ${after}`}
      ORDER BY ${sql(pk)}
      LIMIT ${batchSize}
    `;
    if (keys.length === 0) break;

    const first = keys[0].k;
    const last = keys[keys.length - 1].k;
    let count: number;
    try {
      const result = await sql`
        UPDATE ${sql(col.table)} SET ${sql(col.column)} = (${sql(col.column)} #>> '{}')::jsonb
        WHERE ${sql(pk)} >= ${first} AND ${sql(pk)} <= ${last}
          AND ${convertible(sql, col.column)}
      `;
      count = result.count;
    } catch (error) {
      if (!isInvalidJson(error)) throw error;
      count = await convertRowByRow(sql, col, pk, first, last);
    }

    scanned += keys.length;
    converted += count;
    onBatch?.({ table: col.table, column: col.column, scanned, converted });

    if (keys.length < batchSize) break;
    after = last;
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  return converted;
}

/** Fallback for a batch containing a malformed value: convert what parses, skip the rest. */
async function convertRowByRow(
  sql: Sql,
  col: JsonbColumn,
  pk: string,
  first: string,
  last: string,
): Promise<number> {
  const rows = await sql<{ k: string }[]>`
    SELECT ${sql(pk)}::text AS k FROM ${sql(col.table)}
    WHERE ${sql(pk)} >= ${first} AND ${sql(pk)} <= ${last}
      AND ${convertible(sql, col.column)}
  `;
  let count = 0;
  for (const { k } of rows) {
    try {
      const result = await sql`
        UPDATE ${sql(col.table)} SET ${sql(col.column)} = (${sql(col.column)} #>> '{}')::jsonb
        WHERE ${sql(pk)} = ${k} AND ${convertible(sql, col.column)}
      `;
      count += result.count;
    } catch (error) {
      if (!isInvalidJson(error)) throw error;
    }
  }
  return count;
}
