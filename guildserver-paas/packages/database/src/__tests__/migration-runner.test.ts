/**
 * Integration tests for the migration runner (packages/database/src/migration-runner.ts).
 *
 * Deliberately NOT jest/vitest — this package has no test runner configured
 * and we don't want to add dependencies that aren't already in the
 * lockfile. This is a small self-contained harness (built on Node's
 * assert module only) that creates its own throwaway Postgres databases,
 * runs assertions against them, and drops them when done — same pattern
 * used to develop and manually verify this fix.
 *
 * Run with:
 *   TEST_DB_ADMIN_URL=postgresql://test:test@localhost:5433/postgres \
 *     npx tsx src/__tests__/migration-runner.test.ts
 *
 * Defaults to the shared local test Postgres server described in this
 * repo's agent docs (postgresql://test:test@localhost:5433) if
 * TEST_DB_ADMIN_URL is not set. Every database this file creates is
 * prefixed `mig_runner_test_` and is always dropped in a `finally`, even
 * on assertion failure — it never touches `guildserver_test` itself.
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";
import {
  MIGRATIONS,
  MIGRATIONS_DIR,
  ensureTrackingTable,
  reconcileDrizzleHistory,
  applyPending,
  baselineMigrations,
  allHandMigrationIds,
  type MigrationManifestEntry,
} from "../migration-runner";
import { verifySchema } from "../verify-schema";

const ADMIN_URL =
  process.env.TEST_DB_ADMIN_URL ?? "postgresql://test:test@localhost:5433/postgres";

function dbUrlFor(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

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

async function withThrowawayDb<T>(
  namePrefix: string,
  fn: (dbUrl: string) => Promise<T>
): Promise<T> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  const dbName = `mig_runner_test_${namePrefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const dbUrl = dbUrlFor(dbName);
  try {
    return await fn(dbUrl);
  } finally {
    const admin2 = postgres(ADMIN_URL, { max: 1 });
    try {
      // Terminate any lingering connections before dropping.
      await admin2.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
      await admin2.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      await admin2.end();
    }
  }
}

async function main() {
  console.log("Migration manifest sanity checks");
  await test("every manifest entry's file exists on disk", async () => {
    for (const m of MIGRATIONS) {
      const p = path.join(MIGRATIONS_DIR, m.file);
      assert.ok(fs.existsSync(p), `missing file for ${m.id}: ${p}`);
    }
  });

  await test("manifest ids are unique", async () => {
    const ids = MIGRATIONS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate id in manifest");
  });

  await test("drizzle family precedes hand family (documented total order)", async () => {
    const families = MIGRATIONS.map((m) => m.family);
    const lastDrizzleIdx = families.lastIndexOf("drizzle");
    const firstHandIdx = families.indexOf("hand");
    assert.ok(
      lastDrizzleIdx < firstHandIdx,
      "expected all drizzle-family entries before all hand-family entries"
    );
  });

  console.log("\nFresh install");
  await withThrowawayDb("fresh", async (dbUrl) => {
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await test("all migrations apply cleanly on an empty database", async () => {
        await ensureTrackingTable(sql);
        const reconciled = await reconcileDrizzleHistory(sql);
        assert.equal(reconciled.length, 0, "nothing to reconcile on a fresh db");
        const results = await applyPending(sql);
        const executed = results.filter((r) => r.status === "executed");
        assert.equal(executed.length, MIGRATIONS.length, "expected every migration to execute");
      });

      await test("re-running on an already-migrated database is a full no-op", async () => {
        const results = await applyPending(sql);
        const executed = results.filter((r) => r.status === "executed");
        const skipped = results.filter((r) => r.status === "skipped");
        assert.equal(executed.length, 0, "expected nothing to execute on second run");
        assert.equal(skipped.length, MIGRATIONS.length);
      });

      await test("verify-schema reports only the known, documented drift", async () => {
        const drifts = await verifySchema(sql);
        // instance_types/instances are managed by migrate-instances.ts, a
        // separate script outside migrations/ — expected to show up here.
        // payment_methods.stripe_payment_method_id is a real mismatch
        // between schema/index.ts (declares NOT NULL) and migration
        // 0004_condemned_mad_thinker.sql (explicitly drops NOT NULL to
        // support non-Stripe payment methods) — cannot be fixed from this
        // package without editing schema/index.ts, which is out of scope.
        const unexpected = drifts.filter(
          (d) =>
            d.table !== "instance_types" &&
            d.table !== "instances" &&
            !(d.table === "payment_methods" && d.column === "stripe_payment_method_id")
        );
        assert.deepEqual(
          unexpected,
          [],
          `unexpected schema drift: ${JSON.stringify(unexpected, null, 2)}`
        );
      });
    } finally {
      await sql.end();
    }
  });

  console.log("\nProduction-shaped upgrade (0000-0003 via drizzle journal, 0004+ applied by hand)");
  await withThrowawayDb("prodshape", async (dbUrl) => {
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await test("simulated production history sets up without error", async () => {
        await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
        await sql.unsafe(`
          CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
            id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
          )
        `);
        const drizzleFamily = MIGRATIONS.filter((m) => m.family === "drizzle");
        for (const m of drizzleFamily) {
          const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, m.file), "utf8");
          for (const stmt of raw.split("--> statement-breakpoint")) {
            const trimmed = stmt.trim();
            if (trimmed) await sql.unsafe(trimmed);
          }
        }
        // Only 0000-0003 are recorded as drizzle-tracked (matches the real
        // test and production databases, which both show exactly 4 rows).
        await sql.unsafe(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('a',1),('b',2),('c',3),('d',4)`
        );

        // Hand family applied "by hand", untracked by any tool.
        const handFamily = MIGRATIONS.filter((m) => m.family === "hand");
        for (const m of handFamily) {
          const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, m.file), "utf8");
          for (const stmt of raw.split("--> statement-breakpoint")) {
            const trimmed = stmt.trim();
            if (trimmed) await sql.unsafe(trimmed);
          }
        }
      });

      await test("runner reconciles the 4 drizzle-tracked rows without re-executing them", async () => {
        await ensureTrackingTable(sql);
        const reconciled = await reconcileDrizzleHistory(sql);
        assert.deepEqual(reconciled, [
          "0000_moaning_dragon_man",
          "0001_mixed_mister_fear",
          "0002_parallel_sunspot",
          "0003_late_chronomancer",
        ]);
      });

      await test("applying the rest against already-hand-migrated schema raises no errors", async () => {
        // Every remaining migration (drizzle's 0004 + the whole hand
        // family) re-runs its SQL here, even though the objects already
        // exist from the manual DDL above — this is exactly the
        // idempotency guarantee under test.
        const results = await applyPending(sql);
        assert.equal(results.length, MIGRATIONS.length);
      });

      await test("a second full run is now a pure no-op", async () => {
        const results = await applyPending(sql);
        const executed = results.filter((r) => r.status === "executed");
        assert.equal(executed.length, 0, "expected no-op on an already-migrated production-shaped db");
      });
    } finally {
      await sql.end();
    }
  });

  console.log("\nBaseline (mark-as-applied without executing)");
  await withThrowawayDb("baseline", async (dbUrl) => {
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await test("baseline marks ids applied without running their SQL", async () => {
        await ensureTrackingTable(sql);
        const ids = ["0001_add_performance_indexes", "0011_app_persistent_storage"];
        const { baselined, alreadyTracked } = await baselineMigrations(sql, ids);
        assert.deepEqual(baselined.sort(), ids.sort());
        assert.deepEqual(alreadyTracked, []);

        const tableExists = await sql.unsafe<{ exists: boolean }[]>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'applications') AS exists`
        );
        assert.equal(tableExists[0]?.exists, false, "baseline must not execute any DDL");
      });

      await test("baseline rejects an unknown id", async () => {
        await assert.rejects(() => baselineMigrations(sql, ["not_a_real_migration"]));
      });

      await test("a normal run skips baselined ids and executes everything else", async () => {
        const results = await applyPending(sql);
        const byId = new Map(results.map((r) => [r.id, r.status]));
        assert.equal(byId.get("0001_add_performance_indexes"), "skipped");
        assert.equal(byId.get("0011_app_persistent_storage"), "skipped");
        const executed = results.filter((r) => r.status === "executed");
        assert.equal(executed.length, MIGRATIONS.length - 2);
      });
    } finally {
      await sql.end();
    }
  });

  console.log("\nDrift detection");
  await withThrowawayDb("drift", async (dbUrl) => {
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await test("verify-schema reports a missing column before its migration runs", async () => {
        await ensureTrackingTable(sql);
        // Apply everything except the migration that adds persistent_storage_path.
        for (const m of MIGRATIONS) {
          if (m.id === "0011_app_persistent_storage") continue;
          const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, m.file), "utf8");
          for (const stmt of raw.split("--> statement-breakpoint")) {
            const trimmed = stmt.trim();
            if (trimmed) await sql.unsafe(trimmed);
          }
        }
        const drifts = await verifySchema(sql);
        const found = drifts.find(
          (d) => d.table === "applications" && d.column === "persistent_storage_path"
        );
        assert.ok(found, "expected verify-schema to flag the missing column");
      });
    } finally {
      await sql.end();
    }
  });

  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exitCode = 1;
});
