/**
 * The guard that stops `pnpm test` from truncating a live GuildServer database.
 */
import {
  DEFAULT_TEST_DATABASE_URL,
  assertNotProductionDatabase,
  redactDatabaseUrl,
  resolveTestDatabaseUrl,
} from "./test-database-url";

const LIVE = "postgresql://guildserver:hunter2@localhost:5432/guildserver";
const TESTDB = "postgresql://test:test@localhost:5433/guildserver_test";

describe("resolveTestDatabaseUrl", () => {
  it("prefers TEST_DATABASE_URL", () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TESTDB } as any)).toBe(TESTDB);
  });

  it("falls back to a local default when nothing is set", () => {
    expect(resolveTestDatabaseUrl({} as any)).toBe(DEFAULT_TEST_DATABASE_URL);
  });

  it("refuses to inherit a DATABASE_URL that is not obviously a test database", () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: LIVE } as any)).toThrow(/live GuildServer database/);
  });

  it("refuses a live-looking URL even when passed explicitly as TEST_DATABASE_URL", () => {
    // The most dangerous case: someone copies the production URL into the
    // variable whose name implies safety.
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: LIVE } as any)).toThrow(
      /live GuildServer database/,
    );
  });

  it("accepts an inherited DATABASE_URL that names a test database", () => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: TESTDB } as any)).toBe(TESTDB);
  });

  it("refuses an inherited non-guildserver URL that is not marked as a test database", () => {
    expect(() =>
      resolveTestDatabaseUrl({ DATABASE_URL: "postgresql://a:b@db.example.com:5432/customer" } as any),
    ).toThrow(/does not look like a test database/);
  });
});

describe("assertNotProductionDatabase", () => {
  it("refuses NODE_ENV=production outright", () => {
    expect(() => assertNotProductionDatabase(TESTDB, { NODE_ENV: "production" } as any)).toThrow(
      /NODE_ENV=production/,
    );
  });

  it("allows a database whose name merely contains guildserver plus a test marker", () => {
    expect(() => assertNotProductionDatabase(TESTDB, {} as any)).not.toThrow();
  });

  it("catches the live URL with query parameters appended", () => {
    expect(() =>
      assertNotProductionDatabase(`${LIVE}?sslmode=require`, {} as any),
    ).toThrow(/live GuildServer database/);
  });
});

describe("redactDatabaseUrl", () => {
  it("removes the password so failures can be logged safely", () => {
    expect(redactDatabaseUrl(LIVE)).toBe("postgresql://guildserver:****@localhost:5432/guildserver");
    expect(redactDatabaseUrl(LIVE)).not.toContain("hunter2");
  });
});
