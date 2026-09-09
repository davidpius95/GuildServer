/**
 * Resolve the database URL the test suite is allowed to use.
 *
 * `tests/setup.ts` issues unqualified DELETEs against core tables between
 * tests. On a single-node GuildServer install the control plane's own
 * DATABASE_URL points at the live database, so silently inheriting it would
 * turn `pnpm test` into a customer-data-loss event. This module is the guard.
 *
 * It lives apart from setup.ts because `@guildserver/database` reads
 * DATABASE_URL at import time — the value has to be in the environment before
 * any module graph loads, which is what jest's `setupFiles` phase is for.
 */

export function redactDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]*@/, "://$1:****@");
}

/** Throw if `url` looks like a live GuildServer control-plane database. */
export function assertNotProductionDatabase(url: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run the test suite with NODE_ENV=production.");
  }
  // Database named exactly `guildserver` is the control plane on every install
  // we ship; truncating it destroys applications, deployments and billing.
  if (/\/guildserver(\?|$)/.test(url) && !/test/i.test(url)) {
    throw new Error(
      `Refusing to run tests against what looks like the live GuildServer database ` +
        `(${redactDatabaseUrl(url)}). Run ./scripts/test-env.sh up and set TEST_DATABASE_URL.`,
    );
  }
}

export const DEFAULT_TEST_DATABASE_URL = "postgresql://test:test@localhost:5433/guildserver_test";

export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.TEST_DATABASE_URL;
  if (explicit) {
    assertNotProductionDatabase(explicit, env);
    return explicit;
  }

  const inherited = env.DATABASE_URL;
  if (inherited) {
    assertNotProductionDatabase(inherited, env);
    if (!/test/i.test(inherited)) {
      throw new Error(
        `Refusing to run tests against DATABASE_URL: it does not look like a test database ` +
          `(${redactDatabaseUrl(inherited)}). The suite truncates tables. Set TEST_DATABASE_URL, ` +
          `or run ./scripts/test-env.sh up first.`,
      );
    }
    return inherited;
  }

  return DEFAULT_TEST_DATABASE_URL;
}
