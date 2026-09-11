/**
 * Turn a parsed Compose file into the file we actually hand to Docker.
 *
 * ## Why normalisation exists
 *
 * A Compose file written for one machine assumes it owns that machine: it names
 * its containers, its network is called `default`, its volume is called `data`.
 * Two users deploying the same file from the same README would fight over all
 * three. Normalisation rewrites every identifier into the stack's own namespace
 * and stamps every resource with the stack's UUID, so that:
 *
 *   1. No two stacks can produce the same container, network or volume name.
 *   2. No stack can produce a name an *application* deploy would produce.
 *   3. Every destructive operation can filter on `gs.service.id=<uuid>` and is
 *      therefore incapable of touching anything it does not own.
 *
 * (1) and (2) are about collisions; (3) is about deletion. (3) is the one that
 * actually protects customers, because a collision fails loudly (Docker refuses
 * a duplicate name) whereas a bad delete succeeds silently.
 *
 * ## Namespacing scheme
 *
 *   project name     gs-svc-<slug>-<first 8 of service uuid>
 *   container_name   <project>-<compose service name>
 *   network          <project>_<compose network name>   (plus the shared
 *                    `guildserver` bridge for services with a domain)
 *   volume           <project>_<compose volume name>
 *
 * The `gs-svc-` prefix is not itself the isolation mechanism — a user could
 * name an application `svc-foo` — it is a readability aid. Isolation comes from
 * the embedded UUID fragment plus the label filter.
 *
 * ## Design credit
 *
 * The following conventions were taken from reading Coolify (Apache-2.0):
 * treating the user's file as source of truth and normalising on the way out;
 * the `SERVICE_PASSWORD_*` / `SERVICE_USER_*` / `SERVICE_BASE64_*` /
 * `SERVICE_FQDN_*` placeholder vocabulary for generated credentials; and
 * generating Traefik routing from a per-service domain map rather than from the
 * Compose file's own labels. No code was copied — Coolify is PHP. See
 * docs/attribution/coolify.md.
 */

import yaml from "js-yaml";
import { randomBytes } from "crypto";
import { GS_LABELS, GS_TYPE_SERVICE, NETWORK_NAME } from "../docker/client";
import { buildTraefikLabels } from "../docker/primitives";
import { PUBLISHABLE_SERVICE_TEMPLATES } from "@guildserver/database/dist/seed/service-templates";
import { ParsedCompose, ParsedService, ComposeParseError, parseCompose } from "./parse";

/** Prefix for every Compose-stack project name. Distinct from the app prefix. */
export const STACK_PREFIX = "gs-svc";

export class ComposeNormalizeError extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(problems.length > 1 ? `${message}\n  - ${problems.join("\n  - ")}` : problems[0] || message);
    this.name = "ComposeNormalizeError";
    this.problems = problems.length > 0 ? problems : [message];
  }
}

/**
 * Declare every named volume a service mounts that the file does not declare.
 * Returns the body unchanged when nothing is missing.
 */
export function declareNamedVolumes(composeBody: string): string {
  const doc = yaml.load(composeBody) as Record<string, any> | null;
  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object") return composeBody;

  const declared = new Set(Object.keys(doc.volumes ?? {}));
  const missing: string[] = [];
  for (const service of Object.values<any>(doc.services)) {
    for (const mount of Array.isArray(service?.volumes) ? service.volumes : []) {
      const source =
        typeof mount === "string"
          ? mount.split(":")[0]
          : mount && typeof mount === "object" && (mount.type ?? "volume") === "volume"
            ? mount.source
            : undefined;
      // A named volume is a bare name: not a host path, and not interpolated.
      if (typeof source !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(source)) continue;
      if (!declared.has(source)) {
        declared.add(source);
        missing.push(source);
      }
    }
  }
  if (missing.length === 0) return composeBody;

  doc.volumes = { ...(doc.volumes ?? {}) };
  for (const name of missing) doc.volumes[name] = null;
  return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "stack";
}

/**
 * The `docker compose -p` project name, and the prefix of every resource.
 *
 * The UUID fragment is what makes this unique. Two stacks may be called
 * "wordpress" in two different projects, or even in the same one; their row ids
 * differ, so their resource names differ.
 */
export function stackProjectName(service: { id: string; serviceName: string }): string {
  const short = service.id.replace(/-/g, "").slice(0, 8);
  if (short.length < 8) {
    throw new ComposeNormalizeError("Stack id is too short to namespace resources safely.");
  }
  return `${STACK_PREFIX}-${slugify(service.serviceName)}-${short}`;
}

export function stackContainerName(project: string, composeServiceName: string): string {
  return `${project}-${composeServiceName}`;
}

export function stackVolumeName(project: string, composeVolumeName: string): string {
  return `${project}_${composeVolumeName}`;
}

export function stackNetworkName(project: string, composeNetworkName: string): string {
  return `${project}_${composeNetworkName}`;
}

/**
 * Labels every resource in a stack carries.
 *
 * `MANAGED` is shared with applications on purpose: the sandbox guard and the
 * orphan sweep both key off it, and a stack container is every bit as much a
 * customer workload as an application container is.
 */
export function stackLabels(input: {
  serviceId: string;
  serviceName: string;
  projectId?: string | null;
  deploymentId?: string | null;
  project: string;
  composeServiceName?: string;
}): Record<string, string> {
  const labels: Record<string, string> = {
    [GS_LABELS.MANAGED]: "true",
    [GS_LABELS.TYPE]: GS_TYPE_SERVICE,
    [GS_LABELS.SERVICE_ID]: input.serviceId,
    [GS_LABELS.SERVICE_NAME]: input.serviceName,
    [GS_LABELS.COMPOSE_PROJECT]: input.project,
  };
  if (input.projectId) labels[GS_LABELS.PROJECT_ID] = input.projectId;
  if (input.deploymentId) labels[GS_LABELS.DEPLOYMENT_ID] = input.deploymentId;
  if (input.composeServiceName) labels[GS_LABELS.COMPOSE_SERVICE] = input.composeServiceName;
  return labels;
}

// ---------------------------------------------------------------------------
// Variable expansion
// ---------------------------------------------------------------------------

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomAlnum(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALNUM[bytes[i] % ALNUM.length];
  return out;
}

/**
 * Decide whether an unset variable is one we may invent a value for.
 *
 * Deliberately narrow: only Coolify's explicit `SERVICE_*` vocabulary. The
 * tempting generalisation — "anything ending in _PASSWORD or _API_KEY" — is
 * wrong, because an unset `STRIPE_API_KEY` must fail the deploy rather than get
 * a random 32 characters that silently break every payment. If the user wants
 * a value generated they say so by naming the variable `SERVICE_PASSWORD_*`.
 */
export function generateForPlaceholder(name: string): string | null {
  let m = /^SERVICE_PASSWORD_(?:(\d+)_)?[A-Z0-9_]+$/.exec(name);
  if (m) return randomAlnum(m[1] ? Math.min(Number(m[1]), 128) : 32);

  m = /^SERVICE_USER_[A-Z0-9_]+$/.exec(name);
  if (m) return randomAlnum(16);

  m = /^SERVICE_BASE64_(?:(\d+)_)?[A-Z0-9_]+$/.exec(name);
  if (m) return randomBytes(m[1] ? Math.min(Number(m[1]), 128) : 32).toString("base64");

  m = /^SERVICE_HEX_(?:(\d+)_)?[A-Z0-9_]+$/.exec(name);
  if (m) return randomBytes(m[1] ? Math.min(Number(m[1]), 128) : 16).toString("hex");

  return null;
}

export interface ExpansionResult {
  value: string;
  /** Variables that had no value and no default. */
  missing: string[];
}

/**
 * Expand `${VAR}`, `${VAR:-default}`, `${VAR-default}` and `$VAR`.
 *
 * `$$` is the Compose escape for a literal `$` and is preserved as `$$` so that
 * the daemon (which performs its own second pass) still sees a literal dollar.
 * `${VAR:?message}` is honoured as "required": it reports as missing.
 *
 * Substituted values get their own `$` escaped to `$$` for the same reason. The
 * `docker compose` CLI interpolates the file we hand it a *second* time, so a
 * password containing `$` — which is most of them, from a generator that isn't
 * ours — would otherwise be silently truncated at the `$` or replaced by an
 * empty string. That produces a database whose password in the environment does
 * not match the one it was initialised with, which fails hours later.
 */
function escapeDollars(value: string): string {
  return value.replace(/\$/g, "$$$$");
}

export function expandVariables(input: string, env: Record<string, string>, missing: Set<string>): string {
  let out = "";
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    if (input[i + 1] === "$") {
      out += "$$";
      i += 2;
      continue;
    }

    if (input[i + 1] === "{") {
      const end = input.indexOf("}", i + 2);
      if (end === -1) {
        // Unterminated — emit verbatim rather than guessing.
        out += input.slice(i);
        break;
      }
      const body = input.slice(i + 2, end);
      i = end + 1;

      const sep = body.search(/:?[-?]/);
      if (sep === -1) {
        const name = body;
        if (name in env) out += escapeDollars(env[name]);
        else missing.add(name);
        continue;
      }

      const name = body.slice(0, sep);
      const colon = body[sep] === ":";
      const op = colon ? body[sep + 1] : body[sep];
      const rest = body.slice(colon ? sep + 2 : sep + 1);

      const present = name in env && (!colon || env[name] !== "");
      if (present) {
        out += escapeDollars(env[name]);
      } else if (op === "-") {
        // Defaults may themselves reference variables.
        out += expandVariables(rest, env, missing);
      } else {
        missing.add(name);
      }
      continue;
    }

    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(input.slice(i));
    if (m) {
      if (m[1] in env) out += escapeDollars(env[m[1]]);
      else missing.add(m[1]);
      i += m[0].length;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Collect every `${VAR}`-style reference in a Compose document. */
export function collectVariableNames(raw: string): string[] {
  const names = new Set<string>();
  const re = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-?][^}]*)?\}|([A-Za-z_][A-Za-z0-9_]*))/g;
  let m: RegExpExecArray | null;
  let text = raw;
  // Strip `$$` escapes first so they cannot contribute a false reference.
  text = text.replace(/\$\$/g, "");
  while ((m = re.exec(text))) names.add(m[1] || m[2]);
  return [...names];
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export interface NormalizeInput {
  service: {
    id: string;
    serviceName: string;
    projectId?: string | null;
    templateId?: string | null;
    /** Stored environment for the stack; the substitution source. */
    environment?: Record<string, string> | null;
    /** { composeServiceName: [domain, ...] } */
    domains?: Record<string, string[]> | null;
  };
  composeFile: string;
  deploymentId?: string | null;
  /** Injected for tests; defaults to process.env (read by the Traefik branch). */
  env?: NodeJS.ProcessEnv;
  /** Injected for tests so generated credentials are deterministic. */
  generate?: (name: string) => string | null;
}

export interface NormalizedVolume {
  composeVolumeName: string;
  volumeName: string;
  managed: boolean;
}

export interface NormalizedService {
  composeServiceName: string;
  containerName: string;
  image?: string;
  domains: string[];
  /** The port Traefik routes to, when the service has a domain. */
  routedPort?: number;
  labels: Record<string, string>;
}

export interface NormalizeResult {
  /** `docker compose -p` project name. */
  project: string;
  /** The rendered Compose YAML handed to the CLI. */
  composeResolved: string;
  services: NormalizedService[];
  volumes: NormalizedVolume[];
  networks: string[];
  /** Credentials invented for `SERVICE_*` placeholders; persist these. */
  generatedEnvironment: Record<string, string>;
  notes: string[];
}

export function normalizeCompose(input: NormalizeInput): NormalizeResult {
  const project = stackProjectName(input.service);
  const notes: string[] = [];
  const env: Record<string, string> = { ...(input.service.environment ?? {}) };
  const generate = input.generate ?? generateForPlaceholder;

  // ---- 1. Generate values for placeholder-style variables -----------------
  const generated: Record<string, string> = {};
  for (const name of collectVariableNames(input.composeFile)) {
    if (name in env) continue;
    const value = generate(name);
    if (value != null) {
      env[name] = value;
      generated[name] = value;
    }
  }
  if (Object.keys(generated).length > 0) {
    notes.push(`Generated ${Object.keys(generated).length} credential(s): ${Object.keys(generated).sort().join(", ")}`);
  }

  // ---- 2. Expand variables across the whole document ----------------------
  //
  // Substituting on the raw text (as Compose itself does) rather than on the
  // parsed tree means a variable may expand into structure — `${EXTRA_PORTS}`
  // yielding a list item — exactly as it would locally.
  const missing = new Set<string>();
  const expanded = expandVariables(input.composeFile, env, missing);
  if (missing.size > 0) {
    throw new ComposeNormalizeError(
      "This stack cannot be deployed because some variables have no value.",
      [...missing]
        .sort()
        .map(
          (name) =>
            `\${${name}} is not set and has no default — add it to the stack's environment, or give it a default with \${${name}:-value}`,
        ),
    );
  }

  // ---- 3. Parse the expanded document ------------------------------------
  // Named volumes mounted by services that are not declared under top-level volumes:
  // are auto-declared so that Compose parse succeeds and all volumes are tracked.
  const withVolumes = declareNamedVolumes(expanded);
  let parsed: ParsedCompose;
  try {
    parsed = parseCompose(withVolumes);
  } catch (error) {
    if (error instanceof ComposeParseError) {
      throw new ComposeNormalizeError(error.message.split("\n")[0], error.problems);
    }
    throw error;
  }
  notes.push(...parsed.notes);

  const buildServices = parsed.services.filter((s) => s.build != null && s.image == null);
  if (buildServices.length > 0) {
    throw new ComposeNormalizeError(
      "This stack cannot be deployed as written.",
      buildServices.map(
        (s) =>
          `services.${s.name}: \`build:\` is not supported for stacks — there is no source checkout to build from. Publish the image to a registry and use \`image:\`, or deploy that component as an Application.`,
      ),
    );
  }

  // ---- 4. Namespace volumes ----------------------------------------------
  const volumes: NormalizedVolume[] = parsed.volumes.map((v) => ({
    composeVolumeName: v.name,
    // An `external:` volume was rejected at parse time, so every volume here is
    // one we create and therefore one we may delete.
    volumeName: stackVolumeName(project, v.name),
    managed: true,
  }));

  // ---- 5. Namespace networks ---------------------------------------------
  const declaredNetworks = parsed.networks.length > 0 ? parsed.networks.map((n) => n.name) : ["default"];
  if (!declaredNetworks.includes("default")) declaredNetworks.unshift("default");
  const networkNames = declaredNetworks.map((n) => stackNetworkName(project, n));

  const domainMap = input.service.domains ?? {};

  // ---- 6. Build the output document --------------------------------------
  const baseLabels = stackLabels({
    serviceId: input.service.id,
    serviceName: input.service.serviceName,
    projectId: input.service.projectId,
    deploymentId: input.deploymentId,
    project,
  });

  const outServices: Record<string, Record<string, unknown>> = {};
  const normalized: NormalizedService[] = [];

  for (const svc of parsed.services) {
    const domains = (domainMap[svc.name] ?? []).filter((d) => typeof d === "string" && d.trim().length > 0);
    const containerName = stackContainerName(project, svc.name);

    const labels: Record<string, string> = {
      // User labels first so platform labels always win. A Compose file that
      // sets `gs.service.id` to another stack's UUID must not be able to make
      // that stack's delete reap this container.
      ...svc.labels,
      ...baseLabels,
      [GS_LABELS.COMPOSE_SERVICE]: svc.name,
    };

    let routedPort: number | undefined;
    if (domains.length > 0) {
      routedPort = pickRoutedPort(svc);
      if (routedPort == null && input.service.templateId) {
        const t = PUBLISHABLE_SERVICE_TEMPLATES.find((x) => x.id === input.service.templateId);
        if (t) {
          const matchedSvc = t.services.find((s) => s.name === svc.name);
          routedPort = matchedSvc?.ports?.[0] ?? t.defaultPort ?? undefined;
        }
      }
      if (routedPort == null) {
        throw new ComposeNormalizeError(
          `services.${svc.name} has a domain but no port to route to — add \`expose: ["<port>"]\` or a \`ports:\` entry.`,
        );
      }
      // Reuse the application path's generator verbatim. If these two ever
      // diverge, a stack and an app with the same domain shape would produce
      // different Traefik router definitions, and Traefik resolves conflicting
      // definitions by dropping the router entirely — an outage. Sharing the
      // function is what makes that impossible.
      const traefik = buildTraefikLabels({
        // Router names are derived from this, so it must be stack-unique.
        appName: `${project}-${svc.name}`,
        domains,
        servicePort: routedPort,
        env: input.env,
      });
      Object.assign(labels, traefik.labels);
      notes.push(...traefik.notes);
    }

    const out: Record<string, unknown> = {
      image: svc.image,
      // We name containers rather than letting Compose do it, because Compose's
      // own scheme (`<project>-<service>-<index>`) is only unique if the project
      // name is, and we would rather that invariant be visible here.
      container_name: containerName,
      restart: svc.restart ?? "unless-stopped",
      labels,
      networks: namespacedNetworksFor(svc, project, declaredNetworks, domains.length > 0),
    };

    if (svc.command != null) out.command = svc.command;
    if (svc.entrypoint != null) out.entrypoint = svc.entrypoint;
    if (Object.keys(svc.environment).length > 0) out.environment = svc.environment;
    if (svc.expose.length > 0) {
      out.expose = svc.expose.map(String);
    } else if (routedPort != null && svc.ports.length === 0) {
      out.expose = [String(routedPort)];
    }
    if (svc.user) out.user = svc.user;
    if (svc.workingDir) out.working_dir = svc.workingDir;
    if (svc.healthcheck) out.healthcheck = svc.healthcheck;
    if (svc.dependsOn.length > 0) {
      // Preserved verbatim; the CLI is what enforces start ordering and it does
      // that better than anything we would write on top of dockerode.
      out.depends_on = svc.dependsOn;
    }
    if (svc.ports.length > 0) {
      out.ports = svc.ports.map((p) =>
        p.published != null ? `${p.published}:${p.target}/${p.protocol}` : `${p.target}/${p.protocol}`,
      );
    }
    if (svc.volumes.length > 0) {
      // Mounts keep the Compose-local key; the rename happens once, in the
      // top-level `volumes:` block via an explicit `name:`. Rewriting it in
      // both places would give two chances to disagree.
      out.volumes = svc.volumes.map((mount) =>
        mount.kind === "anonymous"
          ? mount.target
          : `${mount.source!}:${mount.target}${mount.readOnly ? ":ro" : ""}`,
      );
    }
    if (svc.resources) {
      const limits: Record<string, string> = {};
      if (svc.resources.memoryBytes) limits.memory = String(svc.resources.memoryBytes);
      if (svc.resources.nanoCpus) limits.cpus = String(svc.resources.nanoCpus / 1e9);
      out.deploy = { resources: { limits } };
    }

    outServices[svc.name] = out;
    normalized.push({
      composeServiceName: svc.name,
      containerName,
      image: svc.image,
      domains,
      routedPort,
      labels,
    });
  }

  // Top-level `volumes:` and `networks:` carry an explicit `name:`, which is
  // what actually renames them on the daemon. Compose would otherwise prefix
  // them with the project name itself — the result would be the same today, but
  // relying on that would make our recorded `serviceVolumes.volumeName` a guess
  // about Compose's internals rather than a value we chose.
  const outVolumes: Record<string, unknown> = {};
  for (const v of volumes) {
    outVolumes[v.composeVolumeName] = {
      name: v.volumeName,
      labels: { ...baseLabels, "gs.volume.compose_name": v.composeVolumeName },
    };
  }

  const outNetworks: Record<string, unknown> = {};
  for (const n of declaredNetworks) {
    outNetworks[n] = { name: stackNetworkName(project, n), labels: baseLabels };
  }
  // The shared proxy network is external: Traefik owns it, we only join it, and
  // only for services that actually have a domain.
  const usesProxy = normalized.some((s) => s.domains.length > 0);
  if (usesProxy) {
    outNetworks[NETWORK_NAME] = { name: NETWORK_NAME, external: true };
  }

  const document: Record<string, unknown> = {
    services: outServices,
    ...(Object.keys(outVolumes).length > 0 ? { volumes: outVolumes } : {}),
    networks: outNetworks,
  };

  const composeResolved = yaml.dump(document, { lineWidth: 160, noRefs: true, sortKeys: false });

  return {
    project,
    composeResolved,
    services: normalized,
    volumes,
    networks: usesProxy ? [...networkNames, NETWORK_NAME] : networkNames,
    generatedEnvironment: generated,
    notes,
  };
}

/**
 * Which container port a domain should route to.
 *
 * `expose:` first because it states intent without publishing anything; then a
 * published port's target. Guessing wrong here routes a domain at a Postgres
 * socket, so we never guess a default — the caller gets an error instead.
 */
function pickRoutedPort(svc: ParsedService): number | undefined {
  if (svc.expose.length > 0) return svc.expose[0];
  const published = svc.ports.find((p) => p.published != null) ?? svc.ports[0];
  return published?.target;
}

function namespacedNetworksFor(
  svc: ParsedService,
  project: string,
  declared: string[],
  needsProxy: boolean,
): string[] {
  // Every service joins the stack's own network whatever the file said, so that
  // `depends_on` peers can always resolve each other by Compose service name.
  const nets = new Set<string>(svc.networks.length > 0 ? svc.networks : ["default"]);
  nets.add("default");
  for (const n of nets) {
    if (!declared.includes(n)) nets.delete(n);
  }
  const out = [...nets];
  if (needsProxy) out.push(NETWORK_NAME);
  return out;
}
