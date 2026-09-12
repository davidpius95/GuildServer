/**
 * Is a database engine actually able to serve queries yet?
 *
 * A started container is not a working database. The official PostgreSQL image
 * runs a temporary server on the unix socket while `initdb` is still going and
 * only creates the requested database at the end, so anything that acts on
 * "the container is up" can reach a server that does not have the database yet.
 * That is what made a backup taken moments after creation fail with
 * `pg_dump: FATAL: database "..." does not exist`, and what let the dashboard
 * report "running" before the database could answer.
 *
 * Each probe therefore runs a real query against the *target database* rather
 * than checking a port. Credentials travel as environment variables, never in
 * the command line, so they cannot leak through the container's process list.
 */

import { execInContainer } from "./docker/container";
import { logger } from "../utils/logger";

export interface EngineCredentials {
  databaseName: string;
  username: string;
  password: string;
}

export interface ReadinessProbe {
  cmd: string[];
  env: string[];
}

/** The command that proves `type` can serve `credentials.databaseName`. */
export function readinessProbe(type: string, credentials: EngineCredentials): ReadinessProbe | null {
  const { databaseName, username, password } = credentials;
  switch (type) {
    case "postgresql":
      // `psql -c 'select 1'` fails while initdb is still running and fails
      // again if the database does not exist, which pg_isready would not catch.
      return {
        cmd: ["psql", `--username=${username}`, `--dbname=${databaseName}`, "-tAc", "select 1"],
        env: [`PGPASSWORD=${password}`],
      };
    case "mysql":
    case "mariadb":
      return {
        cmd: ["mysql", `--user=${username}`, `--database=${databaseName}`, "-e", "select 1"],
        env: [`MYSQL_PWD=${password}`],
      };
    case "mongodb":
      return {
        cmd: [
          "sh",
          "-c",
          'mongosh --quiet --username "$MONGO_USER" --password "$MONGO_PWD" --authenticationDatabase admin ' +
            '--eval "db.runCommand({ ping: 1 }).ok" | grep -q 1',
        ],
        env: [`MONGO_USER=${username}`, `MONGO_PWD=${password}`],
      };
    case "redis":
      // redis-cli reads REDISCLI_AUTH, so the password stays out of argv.
      return { cmd: ["sh", "-c", "redis-cli ping | grep -q PONG"], env: [`REDISCLI_AUTH=${password}`] };
    default:
      return null;
  }
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Injected in tests. */
  exec?: typeof execInContainer;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Wait until the engine answers a query against its own database.
 * Returns true once it does, false if it never does within the timeout.
 * An engine with no probe (an unknown type) is reported ready immediately.
 */
export async function waitForEngineReady(
  containerId: string,
  type: string,
  credentials: EngineCredentials,
  options: WaitOptions = {},
): Promise<boolean> {
  const probe = readinessProbe(type, credentials);
  if (!probe) return true;

  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const exec = options.exec ?? execInContainer;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const deadline = now() + timeoutMs;
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      const result = await exec(containerId, probe.cmd, { env: probe.env });
      if (result.exitCode === 0) return true;
    } catch {
      // The container may not accept execs yet; that is simply "not ready".
    }
    if (now() >= deadline) {
      logger.warn(`Database engine ${type} in ${containerId.slice(0, 12)} was not ready after ${attempts} attempt(s)`);
      return false;
    }
    await sleep(intervalMs);
  }
}
