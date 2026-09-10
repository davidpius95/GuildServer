/**
 * Docker Compose parsing and validation.
 *
 * The governing principle here is that **silent omission is the enemy**. A
 * Compose file that mentions `secrets:` or `network_mode: host` and gets
 * deployed with those keys quietly dropped produces a stack that starts, goes
 * green, and does not work — and the user has no way to tell why. Every key we
 * do not honour is therefore rejected by name, with a message that says what to
 * do instead. Supporting fewer keys loudly beats supporting more keys silently.
 *
 * The supported subset is deliberately the one that covers real self-hosted
 * stacks: image, command/entrypoint, environment, env_file, ports, expose,
 * volumes, depends_on, healthcheck, restart, labels, networks and
 * deploy.resources, plus top-level `volumes:` and `networks:`.
 *
 * Design credit: the shape of the supported subset, and the decision to treat
 * the user's file as source-of-truth and normalise on the way to the daemon,
 * were taken from reading Coolify (Apache-2.0). No code was copied; see
 * docs/attribution/coolify.md.
 */

import yaml from "js-yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ComposeParseError extends Error {
  /** One line per distinct problem, so the UI can render a list. */
  readonly problems: string[];

  constructor(message: string, problems: string[] = []) {
    super(problems.length > 1 ? `${message}\n  - ${problems.join("\n  - ")}` : problems[0] || message);
    this.name = "ComposeParseError";
    this.problems = problems.length > 0 ? problems : [message];
  }
}

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

export interface ParsedPort {
  /** Host port, if the file pinned one. Undefined means "let us pick". */
  published?: number;
  target: number;
  protocol: "tcp" | "udp";
  /** Kept so we can round-trip a range like "8000-8005:8000-8005" untouched. */
  raw: string;
}

export interface ParsedVolumeMount {
  kind: "named" | "anonymous";
  /** Name as written in the Compose file. Absent for anonymous volumes. */
  source?: string;
  target: string;
  readOnly: boolean;
  raw: string;
}

export interface ParsedHealthcheck {
  test?: string[] | string;
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
  disable?: boolean;
}

export interface ParsedService {
  name: string;
  image?: string;
  /** Present only so normalisation can reject it with a useful message. */
  build?: unknown;
  command?: string | string[];
  entrypoint?: string | string[];
  environment: Record<string, string>;
  envFile: string[];
  ports: ParsedPort[];
  expose: number[];
  volumes: ParsedVolumeMount[];
  dependsOn: string[];
  healthcheck?: ParsedHealthcheck;
  restart?: string;
  labels: Record<string, string>;
  networks: string[];
  user?: string;
  workingDir?: string;
  resources?: {
    memoryBytes?: number;
    nanoCpus?: number;
  };
}

export interface ParsedCompose {
  services: ParsedService[];
  /** Top-level named volumes, in declaration order. */
  volumes: { name: string; external: boolean; externalName?: string }[];
  networks: { name: string; external: boolean; externalName?: string; internal: boolean }[];
  /** Non-fatal observations worth showing in the deploy log. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Rejection tables
// ---------------------------------------------------------------------------

const TOP_LEVEL_ALLOWED = new Set(["version", "name", "services", "volumes", "networks"]);

/** Top-level keys we recognise but refuse, each with the reason a user needs. */
const TOP_LEVEL_REJECTED: Record<string, string> = {
  secrets:
    "top-level `secrets:` is not supported — put the value in the stack's environment and reference it with ${VAR}",
  configs: "top-level `configs:` is not supported — bake the file into the image or mount a named volume",
  include: "`include:` is not supported — paste the included file's contents inline",
};

const SERVICE_ALLOWED = new Set([
  "image",
  "build",
  "command",
  "entrypoint",
  "environment",
  "env_file",
  "ports",
  "expose",
  "volumes",
  "depends_on",
  "healthcheck",
  "restart",
  "labels",
  "networks",
  "deploy",
  "user",
  "working_dir",
  "stop_grace_period",
  "tty",
  "stdin_open",
  "shm_size",
  "ulimits",
  "sysctls",
  "dns",
  "extra_hosts",
  "hostname",
  "platform",
]);

/**
 * Service keys refused for isolation reasons.
 *
 * Every one of these is a way for one tenant's stack to reach outside its own
 * sandbox — onto the host network, into the host PID namespace, or (via the
 * Docker socket) into every other container on the daemon. On a multi-tenant
 * PaaS they are not "unsupported", they are "never".
 */
const SERVICE_REJECTED: Record<string, string> = {
  container_name:
    "`container_name:` is managed by GuildServer so that stacks cannot collide — remove it and refer to the service by its Compose name",
  network_mode: "`network_mode:` is not supported — stacks always run on their own isolated network",
  privileged: "`privileged:` is not supported",
  cap_add: "`cap_add:` is not supported",
  pid: "`pid:` is not supported",
  ipc: "`ipc:` is not supported",
  userns_mode: "`userns_mode:` is not supported",
  devices: "`devices:` is not supported",
  secrets: "`secrets:` is not supported — use the stack's environment instead",
  configs: "`configs:` is not supported",
  extends: "`extends:` is not supported — paste the extended service inline",
  profiles: "`profiles:` is not supported — every service in the file is deployed",
  scale: "`scale:` is not supported — declare one container per service",
  volumes_from: "`volumes_from:` is not supported — declare the named volume on both services",
  external_links: "`external_links:` is not supported",
  links: "`links:` is legacy and not supported — services already resolve each other by name",
};

const DEPLOY_ALLOWED = new Set(["resources"]);

// ---------------------------------------------------------------------------
// Zod: outer shape only
// ---------------------------------------------------------------------------

/**
 * Zod guards the coarse shape; the hand-written checks below produce the
 * per-key messages. zod's own errors ("Expected object, received array at
 * services.web") are accurate but read like a stack trace, and this output is
 * shown to a user pasting a file they found on GitHub.
 */
const composeDocumentSchema = z.object({
  version: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  services: z.record(z.union([z.record(z.unknown()), z.null()])),
  volumes: z.record(z.union([z.record(z.unknown()), z.null()])).optional(),
  networks: z.record(z.union([z.record(z.unknown()), z.null()])).optional(),
});

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function asStringMap(value: unknown, where: string, problems: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (value == null) return out;

  if (Array.isArray(value)) {
    // List form: ["KEY=value", "BARE_KEY"]
    for (const entry of value) {
      if (typeof entry !== "string") {
        problems.push(`${where}: expected "KEY=value" strings, got ${typeof entry}`);
        continue;
      }
      const eq = entry.indexOf("=");
      if (eq === -1) {
        // Bare key means "inherit from the host environment". On a PaaS there
        // is no host environment to inherit from, so this is always a mistake.
        problems.push(
          `${where}: "${entry}" has no value. Bare keys inherit from the host shell, which does not exist here — write ${entry}=... or ${entry}=\${${entry}}`,
        );
        continue;
      }
      out[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return out;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v == null) {
        problems.push(
          `${where}: "${k}" has no value. Bare keys inherit from the host shell, which does not exist here — give it a value or use \${${k}}`,
        );
        continue;
      }
      if (typeof v === "object") {
        problems.push(`${where}: "${k}" must be a scalar, got ${Array.isArray(v) ? "a list" : "an object"}`);
        continue;
      }
      out[k] = String(v);
    }
    return out;
  }

  problems.push(`${where}: expected a mapping or a list`);
  return out;
}

function asStringList(value: unknown, where: string, problems: string[]): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) {
      if (typeof v === "string" || typeof v === "number") out.push(String(v));
      else problems.push(`${where}: expected strings, got ${typeof v}`);
    }
    return out;
  }
  problems.push(`${where}: expected a string or a list of strings`);
  return [];
}

const PORT_RE = /^(?:(?:(?<host>[\d.]+):)?(?<published>\d+):)?(?<target>\d+)(?:\/(?<proto>tcp|udp))?$/;

function parsePorts(value: unknown, where: string, problems: string[]): ParsedPort[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    problems.push(`${where}: \`ports:\` must be a list`);
    return [];
  }

  const out: ParsedPort[] = [];
  for (const entry of value) {
    if (typeof entry === "number") {
      out.push({ target: entry, protocol: "tcp", raw: String(entry) });
      continue;
    }

    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      // Long form: { target: 80, published: 8080, protocol: tcp }
      const o = entry as Record<string, unknown>;
      const target = Number(o.target);
      if (!Number.isInteger(target)) {
        problems.push(`${where}: \`ports:\` entry is missing a numeric \`target\``);
        continue;
      }
      const published = o.published != null ? Number(o.published) : undefined;
      if (published != null && !Number.isInteger(published)) {
        problems.push(`${where}: \`ports:\` entry has a non-numeric \`published\` (ranges are not supported)`);
        continue;
      }
      const protocol = o.protocol === "udp" ? "udp" : "tcp";
      out.push({
        target,
        published,
        protocol,
        raw: published != null ? `${published}:${target}/${protocol}` : `${target}/${protocol}`,
      });
      continue;
    }

    if (typeof entry !== "string") {
      problems.push(`${where}: \`ports:\` entry must be a string, number or mapping`);
      continue;
    }

    if (entry.includes("-")) {
      problems.push(
        `${where}: port range "${entry}" is not supported — list each port individually so the platform can track it`,
      );
      continue;
    }

    const m = PORT_RE.exec(entry.trim());
    if (!m?.groups) {
      problems.push(`${where}: could not understand port "${entry}"`);
      continue;
    }
    if (m.groups.host) {
      problems.push(
        `${where}: port "${entry}" binds a specific host interface, which the platform manages — write it as "${m.groups.published}:${m.groups.target}"`,
      );
      continue;
    }
    out.push({
      target: Number(m.groups.target),
      published: m.groups.published ? Number(m.groups.published) : undefined,
      protocol: m.groups.proto === "udp" ? "udp" : "tcp",
      raw: entry,
    });
  }
  return out;
}

/** A valid Compose named-volume source: no slash, no dot-prefix. */
const NAMED_VOLUME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function parseVolumes(value: unknown, where: string, problems: string[]): ParsedVolumeMount[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    problems.push(`${where}: \`volumes:\` must be a list`);
    return [];
  }

  const out: ParsedVolumeMount[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const o = entry as Record<string, unknown>;
      const type = String(o.type ?? "volume");
      const target = typeof o.target === "string" ? o.target : "";
      if (!target) {
        problems.push(`${where}: \`volumes:\` entry is missing \`target\``);
        continue;
      }
      if (type === "bind") {
        problems.push(
          `${where}: bind mount of "${o.source}" is not supported — the host filesystem is shared between tenants. Use a named volume instead.`,
        );
        continue;
      }
      if (type !== "volume") {
        problems.push(`${where}: volume type "${type}" is not supported (only named volumes are)`);
        continue;
      }
      const source = typeof o.source === "string" ? o.source : undefined;
      out.push({
        kind: source ? "named" : "anonymous",
        source,
        target,
        readOnly: o.read_only === true,
        raw: `${source ?? ""}:${target}`,
      });
      continue;
    }

    if (typeof entry !== "string") {
      problems.push(`${where}: \`volumes:\` entry must be a string or mapping`);
      continue;
    }

    const parts = entry.split(":");
    if (parts.length === 1) {
      out.push({ kind: "anonymous", target: parts[0], readOnly: false, raw: entry });
      continue;
    }
    if (parts.length > 3) {
      problems.push(`${where}: could not understand volume "${entry}"`);
      continue;
    }

    const [source, target, mode] = parts;

    // This is the check that keeps a tenant off the host filesystem, and the
    // Docker socket in particular: `- /var/run/docker.sock:/var/run/docker.sock`
    // is root on every other container on the daemon.
    if (source.startsWith("/") || source.startsWith(".") || source.startsWith("~")) {
      const socket = source.includes("docker.sock");
      problems.push(
        `${where}: bind mount "${entry}" is not supported — the host filesystem is shared between tenants` +
          (socket
            ? ". Mounting the Docker socket would grant control of every container on this host."
            : ". Use a named volume instead."),
      );
      continue;
    }
    if (!NAMED_VOLUME_RE.test(source)) {
      problems.push(`${where}: "${source}" is not a valid named volume`);
      continue;
    }
    out.push({
      kind: "named",
      source,
      target,
      readOnly: mode === "ro" || mode?.split(",").includes("ro") === true,
      raw: entry,
    });
  }
  return out;
}

function parseDependsOn(value: unknown, where: string, problems: string[]): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return asStringList(value, `${where}.depends_on`, problems);
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>);
  problems.push(`${where}: \`depends_on:\` must be a list or a mapping`);
  return [];
}

/** "512m", "1.5g", "1024" -> bytes. Returns null when unparseable. */
export function parseMemoryString(value: unknown): number | null {
  if (typeof value === "number") return Math.floor(value);
  if (typeof value !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)\s*([bkmgt]?)b?$/i.exec(value.trim());
  if (!m) return null;
  const units: Record<string, number> = { "": 1, b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
  return Math.floor(parseFloat(m[1]) * units[m[2].toLowerCase()]);
}

function parseDeploy(value: unknown, where: string, problems: string[]): ParsedService["resources"] {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${where}: \`deploy:\` must be a mapping`);
    return undefined;
  }

  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key === "replicas") {
      // Silently honouring replicas: 1 and silently ignoring replicas: 3 is
      // exactly the failure mode this parser exists to prevent.
      if (Number(o.replicas) === 1) continue;
      problems.push(`${where}: \`deploy.replicas: ${String(o.replicas)}\` is not supported — one container per service`);
      continue;
    }
    if (!DEPLOY_ALLOWED.has(key)) {
      problems.push(`${where}: \`deploy.${key}\` is not supported (only \`deploy.resources\` is)`);
    }
  }

  const limits = (o.resources as Record<string, unknown> | undefined)?.limits as Record<string, unknown> | undefined;
  if (!limits) return undefined;

  const out: NonNullable<ParsedService["resources"]> = {};
  if (limits.memory != null) {
    const bytes = parseMemoryString(limits.memory);
    if (bytes == null) problems.push(`${where}: could not understand memory limit "${String(limits.memory)}"`);
    else out.memoryBytes = bytes;
  }
  if (limits.cpus != null) {
    const cpus = parseFloat(String(limits.cpus));
    if (!Number.isFinite(cpus)) problems.push(`${where}: could not understand cpu limit "${String(limits.cpus)}"`);
    else out.nanoCpus = Math.floor(cpus * 1e9);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseHealthcheck(value: unknown, where: string, problems: string[]): ParsedHealthcheck | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${where}: \`healthcheck:\` must be a mapping`);
    return undefined;
  }
  const o = value as Record<string, unknown>;
  const hc: ParsedHealthcheck = {};
  if (o.disable === true) return { disable: true };
  if (o.test != null) {
    if (typeof o.test === "string") hc.test = o.test;
    else if (Array.isArray(o.test)) hc.test = o.test.map(String);
    else problems.push(`${where}: \`healthcheck.test\` must be a string or a list`);
  }
  for (const key of ["interval", "timeout", "start_period"] as const) {
    if (o[key] != null) hc[key] = String(o[key]);
  }
  if (o.retries != null) {
    const n = Number(o.retries);
    if (!Number.isInteger(n)) problems.push(`${where}: \`healthcheck.retries\` must be an integer`);
    else hc.retries = n;
  }
  return hc;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseCompose(raw: string): ParsedCompose {
  if (!raw || !raw.trim()) {
    throw new ComposeParseError("The Compose file is empty.");
  }

  let doc: unknown;
  try {
    // js-yaml's default schema is the safe (core) schema: no arbitrary JS
    // object construction, so an untrusted file cannot execute anything here.
    doc = yaml.load(raw, { filename: "compose.yaml" });
  } catch (error: any) {
    const mark = error?.mark;
    const at = mark ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : "";
    throw new ComposeParseError(`The Compose file is not valid YAML${at}: ${error?.reason || error?.message}`);
  }

  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new ComposeParseError("The Compose file must be a YAML mapping with a top-level `services:` key.");
  }

  const problems: string[] = [];
  const notes: string[] = [];
  const root = doc as Record<string, unknown>;

  for (const key of Object.keys(root)) {
    if (key.startsWith("x-")) continue; // Compose extension fields; harmless.
    if (TOP_LEVEL_REJECTED[key]) {
      problems.push(TOP_LEVEL_REJECTED[key]);
      continue;
    }
    if (!TOP_LEVEL_ALLOWED.has(key)) {
      problems.push(`unknown top-level key \`${key}:\``);
    }
  }

  if (root.services == null) {
    throw new ComposeParseError("The Compose file has no `services:` key.");
  }
  if (root.version != null) {
    notes.push("`version:` is obsolete in the Compose specification and is ignored.");
  }
  if (root.name != null) {
    notes.push("`name:` is ignored — the project name is assigned by GuildServer so stacks cannot collide.");
  }

  const shape = composeDocumentSchema.safeParse({
    version: root.version,
    name: root.name,
    services: root.services,
    volumes: root.volumes,
    networks: root.networks,
  });
  if (!shape.success) {
    throw new ComposeParseError(
      "The Compose file's structure is not valid.",
      shape.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
    );
  }

  const serviceEntries = Object.entries(shape.data.services);
  if (serviceEntries.length === 0) {
    throw new ComposeParseError("The Compose file declares no services.");
  }

  const services: ParsedService[] = [];
  for (const [name, rawService] of serviceEntries) {
    const where = `services.${name}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      problems.push(`${where}: "${name}" is not a valid service name`);
      continue;
    }
    if (rawService == null) {
      problems.push(`${where}: has no configuration`);
      continue;
    }

    const s = rawService as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      if (key.startsWith("x-")) continue;
      if (SERVICE_REJECTED[key]) {
        problems.push(`${where}: ${SERVICE_REJECTED[key]}`);
        continue;
      }
      if (!SERVICE_ALLOWED.has(key)) {
        problems.push(`${where}: unknown key \`${key}:\``);
      }
    }

    if (s.image == null && s.build == null) {
      problems.push(`${where}: needs either \`image:\` or \`build:\``);
    }
    if (s.image != null && typeof s.image !== "string") {
      problems.push(`${where}: \`image:\` must be a string`);
    }

    const parsed: ParsedService = {
      name,
      image: typeof s.image === "string" ? s.image : undefined,
      build: s.build,
      command: typeof s.command === "string" ? s.command : Array.isArray(s.command) ? s.command.map(String) : undefined,
      entrypoint:
        typeof s.entrypoint === "string"
          ? s.entrypoint
          : Array.isArray(s.entrypoint)
            ? s.entrypoint.map(String)
            : undefined,
      environment: asStringMap(s.environment, `${where}.environment`, problems),
      envFile: asStringList(s.env_file, `${where}.env_file`, problems),
      ports: parsePorts(s.ports, where, problems),
      expose: asStringList(s.expose, `${where}.expose`, problems)
        .map((p) => Number(String(p).split("/")[0]))
        .filter((p) => Number.isInteger(p)),
      volumes: parseVolumes(s.volumes, where, problems),
      dependsOn: parseDependsOn(s.depends_on, where, problems),
      healthcheck: parseHealthcheck(s.healthcheck, where, problems),
      restart: s.restart != null ? String(s.restart) : undefined,
      labels: asStringMap(s.labels, `${where}.labels`, problems),
      networks: Array.isArray(s.networks)
        ? asStringList(s.networks, `${where}.networks`, problems)
        : s.networks && typeof s.networks === "object"
          ? Object.keys(s.networks as Record<string, unknown>)
          : [],
      user: s.user != null ? String(s.user) : undefined,
      workingDir: typeof s.working_dir === "string" ? s.working_dir : undefined,
      resources: parseDeploy(s.deploy, where, problems),
    };

    if (parsed.envFile.length > 0) {
      problems.push(
        `${where}: \`env_file:\` refers to files on disk that the platform never sees — move those variables into the stack's environment`,
      );
    }

    services.push(parsed);
  }

  // depends_on must reference services that exist; a typo here means the CLI
  // fails with an opaque error at deploy time instead of at save time.
  const known = new Set(services.map((s) => s.name));
  for (const s of services) {
    for (const dep of s.dependsOn) {
      if (!known.has(dep)) {
        problems.push(`services.${s.name}: \`depends_on:\` refers to "${dep}", which is not a service in this file`);
      }
    }
  }

  const volumes = parseTopLevelVolumes(shape.data.volumes, problems);
  const networks = parseTopLevelNetworks(shape.data.networks, problems);

  // Every named mount must have a top-level declaration; Compose itself is
  // lenient here in some versions, and the lenient path creates an untracked
  // volume that stack deletion would then leak forever.
  const declaredVolumes = new Set(volumes.map((v) => v.name));
  for (const s of services) {
    for (const mount of s.volumes) {
      if (mount.kind === "named" && mount.source && !declaredVolumes.has(mount.source)) {
        problems.push(
          `services.${s.name}: volume "${mount.source}" is mounted but not declared under the top-level \`volumes:\` key`,
        );
      }
    }
    const declaredNetworks = new Set(networks.map((n) => n.name));
    for (const net of s.networks) {
      if (!declaredNetworks.has(net) && net !== "default") {
        problems.push(
          `services.${s.name}: network "${net}" is used but not declared under the top-level \`networks:\` key`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new ComposeParseError(`This Compose file cannot be deployed as written (${problems.length} problem(s)).`, problems);
  }

  return { services, volumes, networks, notes };
}

function parseTopLevelVolumes(
  value: Record<string, Record<string, unknown> | null> | undefined,
  problems: string[],
): ParsedCompose["volumes"] {
  if (!value) return [];
  return Object.entries(value).map(([name, cfg]) => {
    const external = cfg?.external === true || (cfg?.external != null && typeof cfg.external === "object");
    if (cfg?.driver != null && cfg.driver !== "local") {
      problems.push(`volumes.${name}: driver "${String(cfg.driver)}" is not supported (only "local")`);
    }
    return {
      name,
      external,
      externalName:
        cfg?.external && typeof cfg.external === "object"
          ? String((cfg.external as Record<string, unknown>).name ?? name)
          : external
            ? typeof cfg?.name === "string"
              ? cfg.name
              : name
            : undefined,
    };
  });
}

function parseTopLevelNetworks(
  value: Record<string, Record<string, unknown> | null> | undefined,
  problems: string[],
): ParsedCompose["networks"] {
  if (!value) return [];
  return Object.entries(value).map(([name, cfg]) => {
    const external = cfg?.external === true || (cfg?.external != null && typeof cfg.external === "object");
    if (external) {
      // An external network is one this stack does not own — joining it is how
      // a stack reaches another tenant's containers.
      problems.push(
        `networks.${name}: \`external: true\` is not supported — a stack may only use networks it owns`,
      );
    }
    if (cfg?.driver != null && cfg.driver !== "bridge") {
      problems.push(`networks.${name}: driver "${String(cfg.driver)}" is not supported (only "bridge")`);
    }
    return { name, external, internal: cfg?.internal === true };
  });
}
