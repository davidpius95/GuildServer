/**
 * jsonb storage with drizzle-orm + postgres-js, and the backfill that repairs
 * rows written before drizzle 0.33 fixed double encoding.
 *
 * Same harness as migration-runner.test.ts: Node's assert, a throwaway
 * database per run (prefixed `jsonb_backfill_test_`), always dropped.
 *
 *   TEST_DB_ADMIN_URL=postgresql://test:test@localhost:5433/postgres \
 *     npx tsx src/__tests__/jsonb-backfill.test.ts
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../schema";
import { ensureTrackingTable, applyPending } from "../migration-runner";
import { backfillColumn, listJsonbColumns, reportColumn } from "../jsonb-backfill";

const ADMIN_URL =
  process.env.TEST_DB_ADMIN_URL ?? "postgresql://test:test@localhost:5433/postgres";

let failures = 0;
let passed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL - ${name}`);
    console.error(err);
  }
}

async function main() {
  const dbName = `jsonb_backfill_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  const { metrics } = schema;

  try {
    await ensureTrackingTable(sql);
    await applyPending(sql);

    console.log("drizzle writes");
    await test("an object is stored as a jsonb object that SQL operators can see", async () => {
      const [row] = await db
        .insert(metrics)
        .values({ name: "write-object", type: "gauge", value: "1", labels: { app: "web", replicas: 2 } })
        .returning();
      const [raw] = await sql`
        SELECT jsonb_typeof(labels) AS kind, labels @> '{"app":"web"}' AS contains, labels->>'replicas' AS replicas
        FROM metrics WHERE id = ${row.id}
      `;
      assert.equal(raw.kind, "object");
      assert.equal(raw.contains, true);
      assert.equal(raw.replicas, "2");
    });

    await test("an array is stored as a jsonb array", async () => {
      const [row] = await db
        .insert(metrics)
        .values({ name: "write-array", type: "gauge", value: "1", labels: ["a", "b"] })
        .returning();
      const [raw] = await sql`SELECT jsonb_typeof(labels) AS kind, labels ? 'a' AS has FROM metrics WHERE id = ${row.id}`;
      assert.equal(raw.kind, "array");
      assert.equal(raw.has, true);
    });

    await test("the column default is a real empty object", async () => {
      const [row] = await db.insert(metrics).values({ name: "write-default", type: "gauge", value: "1" }).returning();
      const [raw] = await sql`SELECT jsonb_typeof(labels) AS kind FROM metrics WHERE id = ${row.id}`;
      assert.equal(raw.kind, "object");
      assert.deepEqual(row.labels, {});
    });

    console.log("\nreading rows written before the fix");
    await test("a string-encoded object still reads back as an object", async () => {
      const [raw] = await sql`
        INSERT INTO metrics (name, type, value, labels)
        VALUES ('legacy-read', 'gauge', 1, to_jsonb(${'{"legacy":true,"n":[1,2]}'}::text))
        RETURNING id
      `;
      const row = await db.query.metrics.findFirst({ where: eq(metrics.id, raw.id) });
      assert.deepEqual(row?.labels, { legacy: true, n: [1, 2] });
    });

    console.log("\nbackfill");
    await sql`DELETE FROM metrics`;
    for (let i = 0; i < 12; i++) {
      await sql`INSERT INTO metrics (name, type, value, labels) VALUES ('legacy', 'gauge', ${i}, to_jsonb(${JSON.stringify({ i, tags: ["x"] })}::text))`;
    }
    await sql`INSERT INTO metrics (name, type, value, labels) VALUES ('legacy-array', 'gauge', 0, to_jsonb(${'["p","q"]'}::text))`;
    await sql`INSERT INTO metrics (name, type, value, labels) VALUES ('malformed', 'gauge', 0, to_jsonb(${'{not json'}::text))`;
    await sql`INSERT INTO metrics (name, type, value, labels) VALUES ('plain-string', 'gauge', 0, to_jsonb(${'hello'}::text))`;
    await db.insert(metrics).values({ name: "already-object", type: "gauge", value: "0", labels: { ok: true } });

    const columns = await listJsonbColumns(sql);
    const labels = columns.find((c) => c.table === "metrics" && c.column === "labels");

    await test("finds jsonb columns with their primary key", async () => {
      assert.ok(labels, "metrics.labels not listed");
      assert.equal(labels!.primaryKey, "id");
      assert.ok(columns.some((c) => c.table === "notification_channels" && c.column === "events"));
    });

    await test("reports JSON-shaped strings separately from plain strings", async () => {
      const report = await reportColumn(sql, labels!);
      assert.equal(report.convertible, 14, "12 objects + 1 array + 1 malformed look JSON-shaped");
      assert.equal(report.otherStrings, 1);
    });

    await test("converts across batches, skipping the malformed value and plain strings", async () => {
      const converted = await backfillColumn(sql, labels!, { batchSize: 4 });
      assert.equal(converted, 13);
      const kinds = await sql<{ name: string; kind: string }[]>`
        SELECT name, jsonb_typeof(labels) AS kind FROM metrics ORDER BY name
      `;
      const byName = (name: string) => kinds.filter((k) => k.name === name).map((k) => k.kind);
      assert.deepEqual([...new Set(byName("legacy"))], ["object"]);
      assert.deepEqual(byName("legacy-array"), ["array"]);
      assert.deepEqual(byName("malformed"), ["string"]);
      assert.deepEqual(byName("plain-string"), ["string"]);
      assert.deepEqual(byName("already-object"), ["object"]);
    });

    await test("converted values read back unchanged and are queryable", async () => {
      const rows = await db.query.metrics.findMany({ where: eq(metrics.name, "legacy") });
      assert.deepEqual(rows.map((r) => (r.labels as any).i).sort((a, b) => a - b), [...Array(12).keys()]);
      const [hit] = await sql`SELECT count(*)::int AS n FROM metrics WHERE labels @> '{"tags":["x"]}'`;
      assert.equal(hit.n, 12);
    });

    await test("is idempotent", async () => {
      assert.equal(await backfillColumn(sql, labels!, { batchSize: 4 }), 0);
    });
  } finally {
    await sql.end();
    const admin2 = postgres(ADMIN_URL, { max: 1 });
    try {
      await admin2.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await admin2.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      await admin2.end();
    }
  }

  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
