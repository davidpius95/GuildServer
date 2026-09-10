/**
 * Rolling (zero-downtime) deploys.
 *
 * WHAT WAS WRONG
 * --------------
 * `deployContainer` removed the running container before it created the new
 * one. Two consequences, both bad:
 *   - every deploy was a hard outage for however long the new container took to
 *     pull, start and warm up;
 *   - a deploy that failed to start left the app DOWN, not merely un-updated.
 *
 * WHAT THIS DOES
 * --------------
 *   createCandidate    start the new image on a fresh host port, with the app's
 *                      labels but NO Traefik router labels, so it is invisible
 *                      to production traffic while it is unproven.
 *   health gate        the app's configured health check, or the legacy
 *                      reachability probe when none is configured.
 *   promoteCandidate   move traffic (see "PROMOTION MECHANISM" below).
 *   retireIncumbent    stop the old container honouring its stop grace period,
 *                      then remove it.
 *
 * If the candidate never becomes healthy it is destroyed, the incumbent is left
 * serving untouched, and the deploy fails with the candidate's logs attached.
 * A failed deploy is now a no-op rather than an outage.
 *
 * PROMOTION MECHANISM
 * -------------------
 * Traefik's docker provider reads routing from container labels, and Docker
 * cannot change labels on a running container. So a container that was created
 * without router labels can never acquire them. Promotion therefore recreates
 * the *proven artifact*: the same image, env, mounts and limits that just
 * passed the health gate, this time with the full Traefik label set.
 *
 * Two containers then publish the same Traefik router and service names. Traefik
 * merges them into one load-balanced service and serves from BOTH — but only if
 * their label sets agree. If they disagree Traefik logs "defined multiple times
 * with different configurations" and DROPS the router, taking the app down
 * entirely. `traefikFingerprint` compares them and we pick:
 *
 *   overlap  fingerprints match — start the promoted container, let Traefik
 *            converge, then retire the incumbent. No gap in which nothing is
 *            serving.
 *   serial   fingerprints differ (domain changed, port moved, CLOUDFLARE_TUNNEL
 *            flipped, health-check labels newly added) — retire the incumbent
 *            first, then start the promoted container. A real gap, but bounded
 *            by one container start rather than a whole pull+build+boot, and it
 *            self-heals: the next deploy's incumbent matches and overlaps.
 *
 * The file-provider alternative (a dynamic config file on a volume shared with
 * Traefik) would give a genuinely atomic switch with no label-identity
 * constraint. It is not implemented here because it needs Traefik itself
 * reconfigured with `--providers.file.directory` and a shared volume — changes
 * outside this service and unsafe to land on a host that auto-deploys from main.
 * See the report for the measured gap that would justify it.
 */

import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { checkContainerHealth } from "./health";
import type { HealthCheckConfig } from "./deploy-config";
import { traefikConvergeMs } from "./deploy-config";
import {
  ContainerSpec,
  GS_ROLE_CANDIDATE,
  GS_ROLE_LABEL,
  buildContainerConfig,
  getStartupFailure,
  findAvailablePort,
  makeContainerName,
  stopAndRemove,
  tailContainerLogs,
  traefikFingerprint,
} from "./primitives";
import { GS_LABELS } from "./client";

export type PromotionMode = "overlap" | "serial" | "cold";

export interface RollingDeployInput {
  docker: Docker;
  spec: ContainerSpec;
  /** gs.* labels, identical for candidate and promoted container. */
  appLabels: Record<string, string>;
  /** traefik.* labels. Empty when the app has no domain. */
  traefikLabels: Record<string, string>;
  applicationId: string;
  appName: string;
  deploymentId: string;
  /** Preview containers scope their incumbent search by app name, as the legacy path does. */
  appNameFilter?: string;
  healthConfig: HealthCheckConfig | null;
  stopGraceSeconds: number;
  healthTimeoutMs?: number;
  userId?: string;
  log: (msg: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface RollingDeployResult {
  containerId: string;
  containerName: string;
  hostPort: number;
  mode: PromotionMode;
  retiredContainerIds: string[];
  candidateContainerId: string;
  previousContainerId: string | null;
}

/**
 * Raised when the candidate never became healthy.
 *
 * Carries the candidate's logs so the deployment record can show WHY the new
 * version was rejected — the incumbent is still serving, so this is information,
 * not an incident.
 */
export class CandidateFailedError extends Error {
  readonly candidateLogs: string[];
  readonly incumbentPreserved: boolean;

  constructor(message: string, candidateLogs: string[], incumbentPreserved: boolean) {
    const tail = candidateLogs.slice(-20);
    super(
      `${message}\nThe previous version is still serving — this deploy changed nothing.` +
        (tail.length > 0 ? `\nCandidate logs:\n${tail.join("\n")}` : ""),
    );
    this.name = "CandidateFailedError";
    this.candidateLogs = candidateLogs;
    this.incumbentPreserved = incumbentPreserved;
  }
}

/** Containers already running for this application, i.e. what is serving today. */
export async function findIncumbents(
  d: Docker,
  applicationId: string,
  options?: { appNameFilter?: string; excludeIds?: string[] },
): Promise<Docker.ContainerInfo[]> {
  const label = [`${GS_LABELS.APP_ID}=${applicationId}`];
  if (options?.appNameFilter) label.push(`${GS_LABELS.APP_NAME}=${options.appNameFilter}`);

  const containers = await d.listContainers({ all: true, filters: { label } });
  const exclude = new Set(options?.excludeIds || []);
  return containers.filter((c) => !exclude.has(c.Id));
}

async function createAndStart(
  d: Docker,
  spec: ContainerSpec,
  args: { name: string; hostPort: number; labels: Record<string, string> },
): Promise<{ container: Docker.Container; containerId: string }> {
  const container = await d.createContainer(buildContainerConfig(spec, args));
  await container.start();
  const inspection = await container.inspect();
  if (!inspection.State.Running) {
    throw new Error(`Container failed to start. Status: ${inspection.State.Status}`);
  }
  const startupFailure = await getStartupFailure(container, inspection.RestartCount || 0);
  if (startupFailure) throw new Error(startupFailure);
  return { container, containerId: inspection.Id };
}

/** Remove a container we created and no longer want. Never throws. */
async function destroyQuietly(container: Docker.Container, log: (m: string) => void): Promise<void> {
  try {
    // t:0 — this container never served traffic, there is nothing to drain.
    await stopAndRemove(container, 0);
  } catch (error: any) {
    log(`Warning: failed to clean up container ${container.id.slice(0, 12)}: ${error.message}`);
  }
}

/**
 * Create and start the unproven new version.
 *
 * Deliberately WITHOUT Traefik labels: an unproven container must not be able to
 * receive production traffic, and Traefik's docker provider routes to a
 * container the moment it starts.
 */
export async function createCandidate(input: RollingDeployInput): Promise<{
  container: Docker.Container;
  containerId: string;
  containerName: string;
  hostPort: number;
}> {
  const { docker: d, log } = input;
  const hostPort = await findAvailablePort(d);
  const containerName = makeContainerName(input.appName, input.deploymentId, "candidate");

  log(`Creating candidate ${containerName} on host port ${hostPort} (no routing yet)...`);
  const { container, containerId } = await createAndStart(d, input.spec, {
    name: containerName,
    hostPort,
    labels: { ...input.appLabels, [GS_ROLE_LABEL]: GS_ROLE_CANDIDATE },
  });

  log(`Candidate ${containerName} is running`);
  return { container, containerId, containerName, hostPort };
}

/** Stop the old container honouring its grace period, then remove it. */
export async function retireIncumbent(
  d: Docker,
  containerId: string,
  stopGraceSeconds: number,
  log: (msg: string) => void,
): Promise<void> {
  const short = containerId.slice(0, 12);
  log(`Retiring previous container ${short} (SIGTERM, ${stopGraceSeconds}s grace)...`);
  try {
    await stopAndRemove(d.getContainer(containerId), stopGraceSeconds);
    log(`Retired ${short}`);
  } catch (error: any) {
    // A container we cannot remove is untidy, not fatal — the new version is
    // already serving. Surface it and move on.
    log(`Warning: could not retire ${short}: ${error.message}`);
    logger.warn(`retireIncumbent(${short}) failed: ${error.message}`);
  }
}

/**
 * Decide how the swap can be performed without Traefik discarding the router.
 *
 * `cold` — nothing is serving, so there is nothing to be careful about.
 * `overlap` — every running incumbent publishes the same Traefik config we are
 *   about to publish, so the two can co-exist as backends of one service.
 * `serial` — at least one differs; overlapping would make Traefik drop the
 *   router and take the app fully down, which is strictly worse than a short gap.
 */
export function decidePromotionMode(
  desiredTraefikLabels: Record<string, string>,
  runningIncumbents: Docker.ContainerInfo[],
): { mode: PromotionMode; reason: string } {
  if (runningIncumbents.length === 0) {
    return { mode: "cold", reason: "no running container to replace" };
  }

  // No domain means no Traefik labels on either side: nothing can conflict.
  const desired = traefikFingerprint(desiredTraefikLabels);

  const diverging = runningIncumbents.filter((c) => traefikFingerprint(c.Labels) !== desired);
  if (diverging.length === 0) {
    return { mode: "overlap", reason: "incumbent publishes an identical Traefik config" };
  }

  return {
    mode: "serial",
    reason:
      "incumbent's Traefik labels differ from this deploy's " +
      "(domain, port or routing mode changed) — overlapping them would make Traefik " +
      "discard the router, so the swap is serialised instead",
  };
}

/**
 * Move traffic onto the proven artifact.
 *
 * See the module header for why this recreates the container rather than
 * relabelling it.
 */
export async function promoteCandidate(
  input: RollingDeployInput,
  args: {
    mode: PromotionMode;
    runningIncumbentIds: string[];
    allIncumbentIds: string[];
  },
): Promise<{ container: Docker.Container; containerId: string; containerName: string; hostPort: number }> {
  const { docker: d, log } = input;
  const labels = { ...input.appLabels, ...input.traefikLabels };
  const containerName = makeContainerName(input.appName, input.deploymentId);
  const hostPort = await findAvailablePort(d);

  if (args.mode === "serial") {
    log("Serialising the swap: retiring the previous container before promoting.");
    for (const id of args.allIncumbentIds) {
      await retireIncumbent(d, id, input.stopGraceSeconds, log);
    }
  }

  log(`Promoting: starting ${containerName} on host port ${hostPort} with routing labels...`);
  const promoted = await createAndStart(d, input.spec, { name: containerName, hostPort, labels });

  if (args.mode === "overlap") {
    const convergeMs = traefikConvergeMs(input.env);
    log(`Both versions are now backends of the same Traefik service; waiting ${convergeMs}ms for convergence.`);
    await new Promise((r) => setTimeout(r, convergeMs));
    for (const id of args.allIncumbentIds) {
      await retireIncumbent(d, id, input.stopGraceSeconds, log);
    }
  }

  return { ...promoted, containerName, hostPort };
}

/**
 * Full rolling deploy: candidate -> health gate -> promote -> retire.
 *
 * Throws `CandidateFailedError` (with the candidate's logs) if the new version
 * never became healthy. In that case nothing about the running application was
 * touched.
 */
export async function rollingDeploy(input: RollingDeployInput): Promise<RollingDeployResult> {
  const { docker: d, log } = input;

  const incumbents = await findIncumbents(d, input.applicationId, { appNameFilter: input.appNameFilter });
  const running = incumbents.filter((c) => c.State === "running");
  const previousContainerId = running[0]?.Id ?? incumbents[0]?.Id ?? null;
  log(
    running.length > 0
      ? `Found ${running.length} running container(s) to replace; they keep serving until the new version is healthy.`
      : "No running container to replace — this is a cold start.",
  );

  const candidate = await createCandidate(input);

  let health;
  try {
    health = await checkContainerHealth({
      containerId: candidate.containerId,
      hostPort: candidate.hostPort,
      expectedContainerPort: input.spec.servicePort,
      config: input.healthConfig,
      userId: input.userId,
      deploymentId: input.deploymentId,
      maxWaitMs: input.healthTimeoutMs,
      dockerClient: d,
    });
  } catch (error: any) {
    const logs = await tailContainerLogs(candidate.container);
    await destroyQuietly(candidate.container, log);
    throw new CandidateFailedError(
      `Health check errored for the new version: ${error.message}`,
      logs,
      running.length > 0,
    );
  }

  if (!health.healthy) {
    const logs = await tailContainerLogs(candidate.container);
    log(`❌ Candidate failed its health check: ${health.message}`);
    await destroyQuietly(candidate.container, log);
    log(
      running.length > 0
        ? "Candidate destroyed. The previous version was never stopped and is still serving."
        : "Candidate destroyed. There was no previous version to fall back to.",
    );
    throw new CandidateFailedError(
      `New version failed its health check: ${health.message}`,
      logs,
      running.length > 0,
    );
  }

  log(`✅ Candidate is healthy: ${health.message}`);

  const { mode, reason } = decidePromotionMode(input.traefikLabels, running);
  log(`Promotion mode: ${mode} — ${reason}`);

  let promoted;
  try {
    promoted = await promoteCandidate(input, {
      mode,
      runningIncumbentIds: running.map((c) => c.Id),
      allIncumbentIds: incumbents.map((c) => c.Id),
    });
  } catch (error: any) {
    // Promotion is a recreate of an artifact we just proved boots, so failing
    // here is rare (port collision, daemon hiccup). In `overlap` mode the
    // incumbent has not been touched yet and is still serving.
    await destroyQuietly(candidate.container, log);
    throw new CandidateFailedError(
      `Failed to promote the new version: ${error.message}`,
      await tailContainerLogs(candidate.container),
      mode === "overlap" && running.length > 0,
    );
  }

  // The candidate has done its job: it proved the image boots. The promoted
  // container is what serves. Two copies of the app running is a waste (and,
  // for anything with a shared volume, a hazard), so retire the candidate now.
  log("Retiring the health-check candidate.");
  await destroyQuietly(candidate.container, log);

  return {
    containerId: promoted.containerId,
    containerName: promoted.containerName,
    hostPort: promoted.hostPort,
    mode,
    retiredContainerIds: incumbents.map((c) => c.Id),
    candidateContainerId: candidate.containerId,
    previousContainerId,
  };
}
