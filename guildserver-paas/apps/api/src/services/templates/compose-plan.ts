/**
 * Turn an interpolated Compose body into a concrete plan of containers to run.
 *
 * Used by scripts/verify-templates.ts to deploy a template on a scratch daemon,
 * and by anything else that needs to know what a Compose body actually asks for
 * before touching a daemon.
 *
 * The guiding rule is that this module refuses what it cannot honour faithfully
 * rather than ignoring it. Quietly dropping a `build:`, a bind mount or a
 * `deploy:` block would let a template appear to deploy without running the
 * code — or with none of the limits — it claims to.
 */

import { load as parseYaml } from "js-yaml";

// ---------------------------------------------------------------------------
// Compose features this runner understands
// ---------------------------------------------------------------------------

/**
 * Keys we know how to honour. Anything else in a service definition means the
 * template needs a Compose engine feature this gate cannot exercise, so it is
 * skipped rather than passed on a partial deployment.
 *
 * This list doubles as the requirements census for the Compose engine: a
 * template skipped here is a template the platform cannot fully deploy either.
 */
const SUPPORTED_SERVICE_KEYS = new Set([
  "image",
  "environment",
  "volumes",
  "healthcheck",
  "depends_on",
  "command",
  "entrypoint",
  "restart",
  "ports",
  "expose",
  "user",
  "working_dir",
  "hostname",
  "labels",
  "networks",
  "tty",
  "stdin_open",
  "stop_grace_period",
  "shm_size",
  "ulimits",
  "sysctls",
  "cap_add",
  "cap_drop",
  "security_opt",
  "pull_policy",
  "platform",
  // Coolify's own key, stripped at import; tolerated here so an older vendored
  // body does not fail the gate on a key the engine never sees.
  "exclude_from_hc",
  // The platform namespaces container names per stack, so this is honoured as a
  // network alias rather than a literal daemon-wide name.
  "container_name",
]);

export class UnsupportedComposeFeature extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedComposeFeature";
  }
}

export interface RunnableService {
  name: string;
  image: string;
  env: string[];
  volumes: Array<{ source: string; target: string; anonymous?: boolean }>;
  healthcheck: Record<string, unknown> | null;
  dependsOn: string[];
  /**
   * A one-shot task whose exiting is success, not failure. Coolify marks these
   * with `exclude_from_hc: true`; `restart: "no"` implies the same.
   */
  oneShot: boolean;
  /** Extra name this service must be reachable under, from `container_name`. */
  alias: string | null;
  command: string[] | string | null;
  entrypoint: string[] | string | null;
  user: string | null;
  workingDir: string | null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => `${key}=${val ?? ""}`);
  }
  return [];
}

/**
 * Turn an interpolated Compose body into something this runner can start.
 *
 * Throws UnsupportedComposeFeature for anything it cannot honour faithfully.
 * Failing loudly matters more than coverage here: quietly ignoring a `build:`
 * or a bind mount would let a template "pass" without ever running the code it
 * claims to.
 */
export function planServices(compose: string): RunnableService[] {
  const doc = parseYaml(compose) as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object" || typeof doc.services !== "object" || doc.services === null) {
    throw new UnsupportedComposeFeature("Compose body has no services mapping after interpolation");
  }

  const plan: RunnableService[] = [];

  for (const [name, raw] of Object.entries(doc.services as Record<string, unknown>)) {
    const definition = (raw ?? {}) as Record<string, unknown>;

    for (const key of Object.keys(definition)) {
      if (!SUPPORTED_SERVICE_KEYS.has(key)) {
        throw new UnsupportedComposeFeature(`service "${name}" uses unsupported Compose key "${key}"`);
      }
    }

    if (typeof definition.image !== "string" || definition.image === "") {
      throw new UnsupportedComposeFeature(`service "${name}" has no image`);
    }

    const volumes: RunnableService["volumes"] = [];
    for (const [index, entry] of asStringArray(definition.volumes).entries()) {
      const [source, target] = entry.split(":");

      // `- /var/lib/data` with no source is an anonymous volume: Docker invents
      // one. We invent a name instead so the volume is labelled and therefore
      // cleaned up; an unlabelled anonymous volume would survive teardown.
      if (!target) {
        volumes.push({ source: `anon-${index}`, target: source, anonymous: true });
        continue;
      }
      // A bind mount would reach outside the sandbox and onto the host
      // filesystem, which this gate will not do.
      if (source.startsWith(".") || source.startsWith("/") || source.startsWith("~")) {
        throw new UnsupportedComposeFeature(`service "${name}" bind-mounts host path "${source}"`);
      }
      volumes.push({ source, target });
    }

    const dependsOn = Array.isArray(definition.depends_on)
      ? definition.depends_on.map(String)
      : definition.depends_on && typeof definition.depends_on === "object"
        ? Object.keys(definition.depends_on as Record<string, unknown>)
        : [];

    plan.push({
      name,
      image: definition.image,
      env: asStringArray(definition.environment),
      volumes,
      healthcheck:
        definition.healthcheck && typeof definition.healthcheck === "object"
          ? (definition.healthcheck as Record<string, unknown>)
          : null,
      dependsOn,
      oneShot: definition.exclude_from_hc === true || String(definition.restart) === "no",
      alias: typeof definition.container_name === "string" ? definition.container_name : null,
      command: (definition.command as string[] | string | undefined) ?? null,
      entrypoint: (definition.entrypoint as string[] | string | undefined) ?? null,
      user: typeof definition.user === "string" ? definition.user : null,
      workingDir: typeof definition.working_dir === "string" ? definition.working_dir : null,
    });
  }

  if (plan.length === 0) {
    throw new UnsupportedComposeFeature("Compose body declares no services");
  }
  return plan;
}

/**
 * Order services so a dependency starts before its dependents.
 *
 * A cycle is not fatal — Compose tolerates them for non-blocking depends_on —
 * so the remaining services are appended in declaration order rather than
 * failing the template on a technicality.
 */
export function startOrder(services: RunnableService[]): RunnableService[] {
  const byName = new Map(services.map((service) => [service.name, service]));
  const ordered: RunnableService[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (service: RunnableService) => {
    if (state.get(service.name)) return;
    state.set(service.name, "visiting");
    for (const dependency of service.dependsOn) {
      const target = byName.get(dependency);
      if (target && state.get(target.name) !== "visiting") visit(target);
    }
    state.set(service.name, "done");
    ordered.push(service);
  };

  for (const service of services) visit(service);
  return ordered;
}

/** Translate a Compose healthcheck into the Docker API's shape. */
export function toDockerHealthcheck(healthcheck: Record<string, unknown>): Record<string, unknown> | undefined {
  const test = healthcheck.test;
  if (!test) return undefined;

  const toNanos = (value: unknown): number | undefined => {
    if (typeof value !== "string") return undefined;
    const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
    if (!match) return undefined;
    const scale = { ms: 1e6, s: 1e9, m: 6e10, h: 3.6e12 }[match[2]]!;
    return Math.round(Number(match[1]) * scale);
  };

  return {
    Test: Array.isArray(test) ? test.map(String) : ["CMD-SHELL", String(test)],
    Interval: toNanos(healthcheck.interval),
    Timeout: toNanos(healthcheck.timeout),
    Retries: typeof healthcheck.retries === "number" ? healthcheck.retries : undefined,
    StartPeriod: toNanos(healthcheck.start_period),
  };
}

// ---------------------------------------------------------------------------
// Gate eligibility
// ---------------------------------------------------------------------------

/** The subset of a catalogue template this predicate needs. */
export interface GateEligible {
  id: string;
  warnings: string[];
  variables: Array<{ kind: string }>;
}

/**
 * Whether a template is worth putting on a daemon at all.
 *
 * A template with warnings already has a known defect, and one needing a
 * variable the platform cannot generate cannot start with real values. Trying
 * either burns minutes of CI for a result we can predict.
 */
export function isGateEligible(template: GateEligible): boolean {
  if (template.warnings.length > 0) return false;
  return !template.variables.some((variable) => variable.kind === "unsupported");
}
