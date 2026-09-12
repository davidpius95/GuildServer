/**
 * Low-level container helpers shared by the legacy (`recreate`) deploy path in
 * `container.ts` and the rolling deploy path in `rolling.ts`.
 *
 * These live in their own module purely to keep the import graph acyclic:
 * container.ts -> rolling.ts -> primitives.ts, never back the other way.
 */

import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { CONTAINER_PREFIX, GS_LABELS, isLocalhostDomain } from "./client";

/**
 * Marks a container that exists only to be health-gated and has not yet been
 * given production routing. Purely observational: nothing in the deploy path
 * makes a correctness decision from it, because Docker labels cannot be changed
 * on a running container and a promoted candidate would therefore carry a stale
 * value forever. It exists so an operator (or an orphan sweep) can tell a
 * half-finished deploy apart from a serving container.
 */
export const GS_ROLE_LABEL = "gs.role";
export const GS_ROLE_CANDIDATE = "candidate";

export function makeContainerName(appName: string, deploymentId: string, suffix?: string): string {
  const shortId = deploymentId.slice(0, 8);
  const base = `${CONTAINER_PREFIX}-${appName}-${shortId}`;
  return suffix ? `${base}-${suffix}` : base;
}

export async function findAvailablePort(dockerClient: Docker): Promise<number> {
  const MIN_PORT = 10000;
  const MAX_PORT = 60000;
  const usedPorts = new Set<number>();

  const containers = await dockerClient.listContainers({ all: true });
  for (const c of containers) {
    if (c.Ports) {
      for (const p of c.Ports) {
        if (p.PublicPort) usedPorts.add(p.PublicPort);
      }
    }
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const port = MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT));
    if (!usedPorts.has(port)) return port;
  }

  throw new Error("No available ports found");
}

export function parseDockerLogs(buffer: Buffer | string): string[] {
  if (typeof buffer === "string") {
    return buffer.split("\n").filter((line) => line.trim());
  }

  const lines: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buffer.length) break;
    const line = buffer.subarray(offset, offset + size).toString("utf8").trim();
    if (line) lines.push(line);
    offset += size;
  }

  return lines;
}

/** Best-effort log tail. Never throws — it is only ever used to explain a failure. */
export async function tailContainerLogs(container: Docker.Container, lines = 50): Promise<string[]> {
  try {
    const buffer = await container.logs({ stdout: true, stderr: true, tail: lines });
    return parseDockerLogs(buffer as unknown as Buffer);
  } catch {
    return [];
  }
}

export async function getStartupFailure(
  container: Docker.Container,
  initialRestartCount: number,
): Promise<string | null> {
  // A newly-started container can look healthy before its entrypoint exits.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const inspection = await container.inspect();
  const restartCount = inspection.RestartCount || 0;
  if (inspection.State.Running && restartCount <= initialRestartCount) return null;

  const recentLogs = (await tailContainerLogs(container, 20)).slice(-8).join("\n");

  const exitCode = inspection.State.ExitCode;
  const state = inspection.State.Status || "exited";
  const suffix = recentLogs ? ` Recent output:\n${recentLogs}` : "";
  return `Container exited during startup (status: ${state}, exit code: ${exitCode}).${suffix}`;
}

/**
 * Stop a container honouring its grace period, then remove it.
 *
 * `t` is Docker's own SIGTERM→SIGKILL window, so an app with a shutdown hook
 * gets `stopGraceSeconds` to finish in-flight requests before it is killed.
 */
export async function stopAndRemove(
  container: Docker.Container,
  stopGraceSeconds: number,
  opts?: { alreadyStopped?: boolean },
): Promise<void> {
  if (!opts?.alreadyStopped) {
    try {
      await container.stop({ t: stopGraceSeconds });
    } catch (error: any) {
      // 304 = already stopped. Anything else is worth a line but not a failure:
      // the remove below is forced and is what actually matters.
      if (error?.statusCode !== 304) {
        logger.warn(`stop(${container.id.slice(0, 12)}) failed: ${error?.message}`);
      }
    }
  }
  await container.remove({ force: true });
}

// ---------------------------------------------------------------------------
// Container spec
// ---------------------------------------------------------------------------

/**
 * Everything needed to materialise a container, computed once per deploy.
 *
 * Both the legacy path and each container the rolling path creates are built
 * from the same spec, so a promoted container is byte-for-byte what the legacy
 * path would have produced apart from its name, host port and label set.
 */
export interface ContainerSpec {
  fullImage: string;
  servicePort: number;
  envArray: string[];
  networkName: string;
  mounts?: Docker.MountSettings[];
  memoryBytes?: number;
  nanoCpus?: number;
  cmd?: string[];
}

export function buildContainerConfig(
  spec: ContainerSpec,
  args: { name: string; hostPort: number; labels: Record<string, string> },
): Docker.ContainerCreateOptions {
  const config: Docker.ContainerCreateOptions = {
    Image: spec.fullImage,
    name: args.name,
    Env: spec.envArray,
    Labels: args.labels,
    ExposedPorts: { [`${spec.servicePort}/tcp`]: {} },
    HostConfig: {
      PortBindings: { [`${spec.servicePort}/tcp`]: [{ HostPort: String(args.hostPort) }] },
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
      NetworkMode: spec.networkName,
    },
  };

  if (spec.cmd && spec.cmd.length > 0) {
    config.Cmd = spec.cmd;
  }
  if (spec.mounts && spec.mounts.length > 0) {
    config.HostConfig!.Mounts = spec.mounts;
  }
  if (spec.memoryBytes) {
    config.HostConfig!.Memory = spec.memoryBytes;
  }
  if (spec.nanoCpus) {
    config.HostConfig!.NanoCpus = spec.nanoCpus;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface AppLabelInput {
  applicationId: string;
  appName: string;
  deploymentId: string;
  projectId: string;
}

export function buildAppLabels(input: AppLabelInput): Record<string, string> {
  return {
    [GS_LABELS.MANAGED]: "true",
    [GS_LABELS.APP_ID]: input.applicationId,
    [GS_LABELS.APP_NAME]: input.appName,
    [GS_LABELS.DEPLOYMENT_ID]: input.deploymentId,
    [GS_LABELS.PROJECT_ID]: input.projectId,
    [GS_LABELS.TYPE]: "application",
  };
}

export interface TraefikLabelResult {
  labels: Record<string, string>;
  /** Lines the deploy log used to emit inline; returned so callers keep the same output. */
  notes: string[];
}

/**
 * Build the Traefik docker-provider labels for an application.
 *
 * Extracted verbatim from `deployContainer` so the rolling path produces a
 * BYTE-IDENTICAL label set to the legacy path. That identity is load-bearing:
 * during a rolling overlap two containers publish the same router and service
 * names, and Traefik only merges them into one load-balanced service when their
 * definitions agree. If they disagree Traefik logs "defined multiple times with
 * different configurations" and DROPS the router — an outage for both
 * containers. `traefikFingerprint` below is what guards against that.
 */
export function buildTraefikLabels(input: {
  appName: string;
  domains?: string[];
  servicePort: number;
  env?: NodeJS.ProcessEnv;
  /**
   * When the app has a configured health-check path, Traefik gets its own
   * load-balancer health check too. That is what closes the last gap in a
   * rolling deploy: without it a newly started backend joins the pool the
   * instant the container starts, so a share of requests hit it while the
   * process is still booting. With it, Traefik keeps the warming backend out
   * of rotation until the path answers.
   *
   * Note these labels change the service definition, so the first deploy after
   * a health-check path is configured will diverge from the incumbent's labels
   * and correctly fall back to a serial swap; every deploy after that overlaps.
   */
  healthCheck?: { path: string; intervalSeconds: number; timeoutSeconds: number } | null;
}): TraefikLabelResult {
  const labels: Record<string, string> = {};
  const notes: string[] = [];
  const domains = input.domains || [];
  if (domains.length === 0) return { labels, notes };

  const env = input.env ?? process.env;
  const routerName = input.appName.replace(/[^a-zA-Z0-9]/g, "-");
  labels["traefik.enable"] = "true";

  const localhostDomains = domains.filter((dm) => isLocalhostDomain(dm));
  const tlsDomains = domains.filter((dm) => !isLocalhostDomain(dm));

  labels[`traefik.http.services.${routerName}.loadbalancer.server.port`] = String(input.servicePort);

  // Retry a request that failed at the network level (connection refused or
  // reset before any response) against another backend. During a rolling
  // swap Traefik learns that the retiring container has stopped only when it
  // processes Docker's event, about a second later; without this, requests
  // routed to it in that window come back as 502s. A retried request never
  // produced a response, but one cut off mid-processing may run twice, so
  // applications should finish in-flight requests on SIGTERM (the stop grace
  // period gives them time to).
  const retryMiddleware = `${routerName}-retry`;
  labels[`traefik.http.middlewares.${retryMiddleware}.retry.attempts`] = "3";
  labels[`traefik.http.middlewares.${retryMiddleware}.retry.initialinterval`] = "100ms";

  if (input.healthCheck) {
    labels[`traefik.http.services.${routerName}.loadbalancer.healthcheck.path`] = input.healthCheck.path;
    labels[`traefik.http.services.${routerName}.loadbalancer.healthcheck.interval`] =
      `${input.healthCheck.intervalSeconds}s`;
    labels[`traefik.http.services.${routerName}.loadbalancer.healthcheck.timeout`] =
      `${input.healthCheck.timeoutSeconds}s`;
  }

  if (localhostDomains.length > 0) {
    const localHostRules = localhostDomains.map((dm) => `Host(\`${dm}\`)`).join(" || ");
    labels[`traefik.http.routers.${routerName}.rule`] = localHostRules;
    labels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
    labels[`traefik.http.routers.${routerName}.middlewares`] = retryMiddleware;
    labels[`traefik.http.routers.${routerName}.service`] = routerName;
  }

  if (tlsDomains.length > 0) {
    const tlsHostRules = tlsDomains.map((dm) => `Host(\`${dm}\`)`).join(" || ");
    const behindTunnel = env.CLOUDFLARE_TUNNEL === "true";

    if (behindTunnel) {
      labels[`traefik.http.routers.${routerName}.rule`] = tlsHostRules;
      labels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
      labels[`traefik.http.routers.${routerName}.middlewares`] = retryMiddleware;
      labels[`traefik.http.routers.${routerName}.service`] = routerName;
      notes.push(`Configured HTTP routing (behind Cloudflare Tunnel) for domains: ${tlsDomains.join(", ")}`);
    } else {
      const tlsRouterName = `${routerName}-secure`;
      labels[`traefik.http.routers.${tlsRouterName}.rule`] = tlsHostRules;
      labels[`traefik.http.routers.${tlsRouterName}.entrypoints`] = "websecure";
      labels[`traefik.http.routers.${tlsRouterName}.tls`] = "true";
      labels[`traefik.http.routers.${tlsRouterName}.tls.certresolver`] = "letsencrypt";
      labels[`traefik.http.routers.${tlsRouterName}.middlewares`] = retryMiddleware;
      labels[`traefik.http.routers.${tlsRouterName}.service`] = routerName;

      const redirectRouterName = `${routerName}-redirect`;
      labels[`traefik.http.routers.${redirectRouterName}.rule`] = tlsHostRules;
      labels[`traefik.http.routers.${redirectRouterName}.entrypoints`] = "web";
      labels[`traefik.http.routers.${redirectRouterName}.middlewares`] = `${routerName}-https-redirect`;
      labels[`traefik.http.routers.${redirectRouterName}.service`] = routerName;
      labels[`traefik.http.middlewares.${routerName}-https-redirect.redirectscheme.scheme`] = "https";
      labels[`traefik.http.middlewares.${routerName}-https-redirect.redirectscheme.permanent`] = "true";
      notes.push(`Configured TLS (Let's Encrypt) for domains: ${tlsDomains.join(", ")}`);
    }
  }

  notes.push(`Configured Traefik routing for domains: ${domains.join(", ")}`);
  return { labels, notes };
}

/**
 * A stable string over just the `traefik.*` labels of a container.
 *
 * Two containers may safely co-exist as backends of one Traefik service only if
 * their fingerprints are equal. When they differ — the operator changed the
 * domain, the container port moved, CLOUDFLARE_TUNNEL was flipped — we must NOT
 * overlap them, because Traefik would discard the conflicting router and take
 * the app down entirely. `rolling.ts` degrades to a serial swap in that case.
 */
export function traefikFingerprint(labels: Record<string, string> | undefined | null): string {
  if (!labels) return "";
  return Object.keys(labels)
    .filter((k) => k.startsWith("traefik."))
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("\n");
}
