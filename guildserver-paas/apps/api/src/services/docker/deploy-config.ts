/**
 * Deployment strategy + health-check configuration.
 *
 * Every field here is OPTIONAL and every `null`/`undefined` MUST reproduce the
 * platform's pre-existing behaviour exactly. The columns these values come from
 * (`applications.deployment_strategy`, `applications.health_check_*`,
 * `applications.stop_grace_period`) are all nullable, so an application row that
 * predates them — i.e. every row today — resolves to the legacy path.
 *
 * Units, chosen to match docker-compose `healthcheck:` conventions so the values
 * mean what an operator expects:
 *   health_check_interval      seconds between polls
 *   health_check_timeout       seconds per individual request
 *   health_check_start_period  seconds to wait before the first poll counts
 *   health_check_retries       consecutive failures tolerated before "unhealthy"
 *   stop_grace_period          seconds between SIGTERM and SIGKILL on retire
 */

export type DeploymentStrategy = "recreate" | "rolling";

/**
 * The default strategy when `applications.deployment_strategy` is NULL.
 *
 * Apps with a domain sit behind Traefik, so a rolling swap is both possible and
 * worth its cost. Apps without a domain are reached only by their ephemeral host
 * port; nothing durable points at them, so the extra container buys nothing and
 * we keep the cheaper legacy path.
 */
export const DEFAULT_STRATEGY_WHEN_UNSET = {
  withDomain: "rolling",
  withoutDomain: "recreate",
} as const satisfies Record<string, DeploymentStrategy>;

/**
 * Global switch for rolling deploys.
 *
 *   unset / "0"  every deploy takes the legacy recreate path
 *   "1"          apps may use rolling, per the precedence in
 *                resolveDeploymentStrategy
 *
 * Default-off is deliberate. Installs deploy from main automatically and
 * unattended, so a merge that silently changed how every domained app is
 * replaced would be a live behaviour change nobody chose. An explicit per-app
 * `deployment_strategy = 'rolling'` still requires this switch: one env var
 * turns the whole feature off during an incident, which is worth more than the
 * convenience of a per-app override that survives it.
 */
export const ZERO_DOWNTIME_ENV = "GS_ZERO_DOWNTIME";

/**
 * Opt-in for rolling deploys on apps with persistent storage.
 *
 * A rolling deploy necessarily has two containers alive at once, and they share
 * one named volume. That is safe for a volume used as a plain file drop (uploads,
 * caches, generated assets) and UNSAFE for anything holding an exclusive lock or
 * an embedded database (SQLite, LevelDB, BoltDB, a lock file). We cannot tell the
 * two apart from the outside, so the safe reading wins by default and the
 * operator opts in per host once they know their workload.
 */
export const SHARED_VOLUME_OPT_IN_ENV = "GS_ZERO_DOWNTIME_SHARED_VOLUME";

/** How long to let Traefik notice the promoted container before retiring the incumbent. */
export const TRAEFIK_CONVERGE_ENV = "GS_TRAEFIK_CONVERGE_MS";
export const TRAEFIK_CONVERGE_DEFAULT_MS = 1500;

/** Applied when `stop_grace_period` is NULL — the value the legacy path already used. */
export const DEFAULT_STOP_GRACE_SECONDS = 10;

/** Defaults for the individual health-check knobs once a `health_check_path` is set. */
export const HEALTH_CHECK_DEFAULTS = {
  intervalSeconds: 5,
  timeoutSeconds: 5,
  retries: 3,
  startPeriodSeconds: 0,
  /** Docker's own default notion of "OK" for an HTTP probe. */
  expectedStatus: "200-399",
} as const;

export interface HealthCheckConfig {
  /** HTTP path to probe, e.g. `/healthz`. Always set when a config exists. */
  path: string;
  /** Container port to probe. Falls back to the resolved service port. */
  port?: number;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds: number;
  /** Raw spec, kept for logging. */
  expectedStatus: string;
  /** Compiled form of `expectedStatus`. */
  matchesStatus: (status: number) => boolean;
}

/**
 * Anything shaped like an `applications` row.
 *
 * Both camelCase (drizzle) and snake_case (raw SQL / jsonb) spellings are read so
 * this keeps working whichever way the row reaches us.
 */
export type ApplicationHealthFields = Record<string, unknown> | null | undefined;

function pick(row: ApplicationHealthFields, camel: string, snake: string): unknown {
  if (!row) return undefined;
  const value = (row as Record<string, unknown>)[camel];
  if (value !== undefined && value !== null) return value;
  const alt = (row as Record<string, unknown>)[snake];
  return alt === null ? undefined : alt;
}

function pickInt(row: ApplicationHealthFields, camel: string, snake: string): number | undefined {
  const raw = pick(row, camel, snake);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : undefined;
}

function pickString(row: ApplicationHealthFields, camel: string, snake: string): string | undefined {
  const raw = pick(row, camel, snake);
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  return s === "" ? undefined : s;
}

/**
 * Compile an expected-status spec into a predicate.
 *
 * Accepts a comma-separated list of single codes and inclusive ranges, e.g.
 * `"200-299,401"` — 401 being genuinely useful, since an authenticated app that
 * answers 401 on `/` has demonstrably booted and is serving.
 *
 * Throws on a malformed spec rather than silently accepting nothing: a typo that
 * quietly matched no status would fail every deploy with a confusing timeout.
 */
export function parseExpectedStatus(spec: string): (status: number) => boolean {
  const parts = spec
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) {
    throw new Error(`Invalid health_check_expected_status: "${spec}" (empty)`);
  }

  const ranges: Array<[number, number]> = [];
  for (const part of parts) {
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(part);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      if (lo > hi) {
        throw new Error(`Invalid health_check_expected_status range "${part}": ${lo} > ${hi}`);
      }
      ranges.push([lo, hi]);
      continue;
    }
    const single = /^(\d{3})$/.exec(part);
    if (single) {
      const code = parseInt(single[1], 10);
      ranges.push([code, code]);
      continue;
    }
    throw new Error(`Invalid health_check_expected_status token "${part}" in "${spec}"`);
  }

  return (status: number) => ranges.some(([lo, hi]) => status >= lo && status <= hi);
}

/**
 * Build a health-check config from an application row.
 *
 * Returns `null` when no `health_check_path` is configured — the caller must then
 * use the legacy reachability probe (`postDeployHealthCheck`), which is exactly
 * today's behaviour.
 */
export function parseHealthCheckConfig(row: ApplicationHealthFields): HealthCheckConfig | null {
  const path = pickString(row, "healthCheckPath", "health_check_path");
  if (!path) return null;

  const expectedStatus =
    pickString(row, "healthCheckExpectedStatus", "health_check_expected_status") ??
    HEALTH_CHECK_DEFAULTS.expectedStatus;

  const positive = (value: number | undefined, fallback: number) =>
    value !== undefined && value > 0 ? value : fallback;

  return {
    path: path.startsWith("/") ? path : `/${path}`,
    port: pickInt(row, "healthCheckPort", "health_check_port"),
    intervalSeconds: positive(
      pickInt(row, "healthCheckInterval", "health_check_interval"),
      HEALTH_CHECK_DEFAULTS.intervalSeconds,
    ),
    timeoutSeconds: positive(
      pickInt(row, "healthCheckTimeout", "health_check_timeout"),
      HEALTH_CHECK_DEFAULTS.timeoutSeconds,
    ),
    retries: positive(pickInt(row, "healthCheckRetries", "health_check_retries"), HEALTH_CHECK_DEFAULTS.retries),
    startPeriodSeconds: Math.max(
      0,
      pickInt(row, "healthCheckStartPeriod", "health_check_start_period") ??
        HEALTH_CHECK_DEFAULTS.startPeriodSeconds,
    ),
    expectedStatus,
    matchesStatus: parseExpectedStatus(expectedStatus),
  };
}

/** Seconds to wait between SIGTERM and SIGKILL when retiring a container. */
export function parseStopGracePeriod(row: ApplicationHealthFields): number {
  const value = pickInt(row, "stopGracePeriod", "stop_grace_period");
  if (value === undefined || value < 0) return DEFAULT_STOP_GRACE_SECONDS;
  return value;
}

/** Read `applications.deployment_strategy` off a row, in either spelling. */
export function readConfiguredStrategy(row: ApplicationHealthFields): string | null {
  return pickString(row, "deploymentStrategy", "deployment_strategy") ?? null;
}

export interface StrategyInput {
  /** `applications.deployment_strategy`; NULL/absent means "decide for me". */
  configured?: string | null;
  hasDomain: boolean;
  /** Preview containers keep the legacy path — see below. */
  isPreview: boolean;
  hasPersistentStorage: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface StrategyDecision {
  strategy: DeploymentStrategy;
  /** Human-readable justification, surfaced in the deploy log. */
  reason: string;
}

/**
 * Decide how this deploy replaces the running container.
 *
 * Precedence, safety first:
 *   1. `GS_ZERO_DOWNTIME` not set to "1" — feature off, no exceptions.
 *   2. Preview containers — scoped per branch, short-lived, and nothing durable
 *      points at them; keeping them on the legacy path preserves the existing
 *      `appNameFilter` semantics untouched.
 *   3. Persistent storage without the shared-volume opt-in.
 *   4. The app's explicit `deployment_strategy`.
 *   5. DEFAULT_STRATEGY_WHEN_UNSET, keyed on whether a domain is configured.
 */
export function resolveDeploymentStrategy(input: StrategyInput): StrategyDecision {
  const env = input.env ?? process.env;

  if (env[ZERO_DOWNTIME_ENV] !== "1") {
    return {
      strategy: "recreate",
      reason: `rolling deploys are off (set ${ZERO_DOWNTIME_ENV}=1 to enable)`,
    };
  }

  if (input.isPreview) {
    return { strategy: "recreate", reason: "preview containers use the legacy replace path" };
  }

  if (input.hasPersistentStorage && env[SHARED_VOLUME_OPT_IN_ENV] !== "1") {
    return {
      strategy: "recreate",
      reason:
        "app has persistent storage; two containers would share one volume " +
        `(set ${SHARED_VOLUME_OPT_IN_ENV}=1 to allow rolling)`,
    };
  }

  const configured = typeof input.configured === "string" ? input.configured.trim().toLowerCase() : "";
  if (configured === "rolling" || configured === "recreate") {
    return { strategy: configured, reason: `application.deployment_strategy = ${configured}` };
  }

  const fallback = input.hasDomain
    ? DEFAULT_STRATEGY_WHEN_UNSET.withDomain
    : DEFAULT_STRATEGY_WHEN_UNSET.withoutDomain;

  return {
    strategy: fallback,
    reason: input.hasDomain
      ? "no strategy configured; app has a domain so defaulting to rolling"
      : "no strategy configured; app has no domain so defaulting to recreate",
  };
}

export function traefikConvergeMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TRAEFIK_CONVERGE_ENV];
  if (!raw) return TRAEFIK_CONVERGE_DEFAULT_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : TRAEFIK_CONVERGE_DEFAULT_MS;
}
