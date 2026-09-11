import Docker from "dockerode";
import { appStorageMount, resolveRuntimePort } from "../app-runtime";
import { PassThrough, Writable } from "stream";
import { logger } from "../../utils/logger";
import { broadcastToUser } from "../../websocket/server";
import { docker, NETWORK_NAME, GS_LABELS } from "./client";
import { ensureNetwork } from "./networks";
import { pullImage, detectDefaultPort, getImageExposedPort } from "./images";
import {
  ContainerSpec,
  GS_ROLE_CANDIDATE,
  GS_ROLE_LABEL,
  buildAppLabels,
  buildContainerConfig,
  buildTraefikLabels,
  findAvailablePort,
  getStartupFailure,
  makeContainerName,
  parseDockerLogs,
} from "./primitives";
import {
  HealthCheckConfig,
  parseHealthCheckConfig,
  parseStopGracePeriod,
  readConfiguredStrategy,
  resolveDeploymentStrategy,
  DeploymentStrategy,
} from "./deploy-config";
import { rollingDeploy, CandidateFailedError } from "./rolling";

export interface DeployOptions {
  deploymentId: string;
  applicationId: string;
  appName: string;
  projectId: string;
  userId: string;
  dockerImage: string;
  dockerTag: string;
  environment: Record<string, string>;
  memoryLimit?: number | null;
  cpuLimit?: number | string | null;
  replicas?: number;
  sourceType: string;
  domains?: string[];
  containerPort?: number;
  persistentStoragePath?: string | null;
  registryAuth?: { username: string; password: string; serveraddress?: string };
  /**
   * The application row (or any subset of it) carrying the nullable
   * `deployment_strategy`, `health_check_*` and `stop_grace_period` columns.
   *
   * Absent or all-NULL — which is every application today — resolves to exactly
   * the pre-existing behaviour: the legacy replace-then-create path and the
   * legacy reachability probe.
   */
  applicationConfig?: Record<string, unknown> | null;
}

export interface DeployResult {
  containerId: string;
  containerName: string;
  hostPort: number;
  logs: string[];
  /** How this deploy replaced the previous container. */
  strategy?: DeploymentStrategy;
  /** For a rolling deploy: how traffic was moved (`overlap` | `serial` | `cold`). */
  promotionMode?: string;
  /** Persisted to `deployments.candidate_container_id` once that column exists. */
  candidateContainerId?: string;
  /** Persisted to `deployments.previous_container_id` once that column exists. */
  previousContainerId?: string | null;
}

export interface ContainerInfo {
  containerId: string;
  containerName: string;
  status: string;
  ports: Array<{ hostPort: number; containerPort: number }>;
  image: string;
  created: Date;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export async function removeExistingContainers(
  applicationId: string,
  options?: { appNameFilter?: string },
  dockerClient?: Docker,
): Promise<void> {
  const d = dockerClient || docker;
  const filters: Record<string, string[]> = {
    label: [`${GS_LABELS.APP_ID}=${applicationId}`],
  };

  if (options?.appNameFilter) {
    filters.label.push(`${GS_LABELS.APP_NAME}=${options.appNameFilter}`);
  }

  const containers = await d.listContainers({ all: true, filters });

  for (const containerInfo of containers) {
    const container = d.getContainer(containerInfo.Id);
    try {
      if (containerInfo.State === "running") {
        logger.info(`Stopping container ${containerInfo.Names[0]}`);
        await container.stop({ t: 10 });
      }
      logger.info(`Removing container ${containerInfo.Names[0]}`);
      await container.remove({ force: true });
    } catch (error: any) {
      logger.warn(`Failed to remove container ${containerInfo.Id}: ${error.message}`);
    }
  }
}

export async function deployContainer(
  opts: DeployOptions,
  dockerClient?: Docker,
): Promise<DeployResult> {
  const d = dockerClient || docker;
  const logs: string[] = [];
  const name = makeContainerName(opts.appName, opts.deploymentId);

  const log = (msg: string) => {
    logs.push(msg);
    logger.info(`[deploy:${name}] ${msg}`);
    broadcastToUser(opts.userId, {
      type: "deployment_log",
      deploymentId: opts.deploymentId,
      log: msg,
      phase: "deploy",
    });
  };

  try {
    await ensureNetwork(d);
    log("Docker network ready");

    const isLocalImage = opts.dockerImage.startsWith("gs-");
    if (!isLocalImage) {
      const pullLogs = await pullImage(opts.dockerImage, opts.dockerTag, opts.userId, opts.deploymentId, d, opts.registryAuth);
      logs.push(...pullLogs);
    } else {
      log(`Using locally built image: ${opts.dockerImage}:${opts.dockerTag}`);
    }

    const isPreviewContainer = opts.appName.includes("-preview-");

    const envArray = Object.entries(opts.environment || {}).map(([key, value]) => `${key}=${value}`);
    const cleanImage = opts.dockerImage.trim().replace(/:$/, "");
    const cleanTag = opts.dockerTag.trim() || "latest";
    const fullImage = `${cleanImage}:${cleanTag}`;

    const appLabels = buildAppLabels({
      applicationId: opts.applicationId,
      appName: opts.appName,
      deploymentId: opts.deploymentId,
      projectId: opts.projectId,
    });

    // Port resolution, most authoritative first:
    //   1. what the user/template explicitly configured
    //   2. what the image actually EXPOSEs
    //   3. a guess from the image name (only useful for known public images)
    //
    // Step 2 was missing, so any app we build ourselves — named `gs-<app>`, and
    // therefore matching nothing in the name map — fell through to 80 while the
    // app listened on 3000/8000. The container ran, health checks passed, and
    // the deploy URL served nothing.
    let servicePort = resolveRuntimePort(opts.containerPort, opts.environment?.PORT);
    if (!servicePort) {
      const exposed = await getImageExposedPort(fullImage, d);
      if (exposed) {
        servicePort = exposed;
        log(`Detected exposed port ${exposed} from image`);
      }
    }
    if (!servicePort) {
      servicePort = detectDefaultPort(cleanImage);
      log(`No explicit or exposed port; falling back to ${servicePort} for ${cleanImage}`);
    }
    log(`Using container port: ${servicePort}`);

    // Per-application health check. NULL `health_check_path` — i.e. every
    // application row today — yields null here and the legacy reachability
    // probe is used instead.
    const healthConfig: HealthCheckConfig | null = parseHealthCheckConfig(opts.applicationConfig);
    const stopGraceSeconds = parseStopGracePeriod(opts.applicationConfig);

    // Traefik gets its own load-balancer health check only when the app has one
    // configured AND that config would accept a plain 200 — Traefik's LB check
    // has its own notion of "OK" and we must not hand it a check that disagrees
    // with the platform's.
    const traefikHealthCheck =
      healthConfig && healthConfig.matchesStatus(200)
        ? {
            path: healthConfig.path,
            intervalSeconds: healthConfig.intervalSeconds,
            timeoutSeconds: healthConfig.timeoutSeconds,
          }
        : null;

    const traefik = buildTraefikLabels({
      appName: opts.appName,
      domains: opts.domains,
      servicePort,
      healthCheck: traefikHealthCheck,
    });
    traefik.notes.forEach(log);

    const mounts: Docker.MountSettings[] = [];
    if (opts.persistentStoragePath) {
      const mount = appStorageMount(opts.applicationId, opts.persistentStoragePath, isPreviewContainer ? opts.appName : undefined);
      await d.createVolume({ Name: mount.Source, Labels: { [GS_LABELS.MANAGED]: "true", [GS_LABELS.APP_ID]: opts.applicationId, [GS_LABELS.TYPE]: "application-storage" } });
      mounts.push(mount);
      log(`Persistent storage mounted at ${mount.Target}`);
    }

    const spec: ContainerSpec = {
      fullImage,
      servicePort,
      envArray,
      networkName: NETWORK_NAME,
      mounts,
      memoryBytes: opts.memoryLimit ? opts.memoryLimit * 1024 * 1024 : undefined,
      nanoCpus: opts.cpuLimit
        ? Math.floor((typeof opts.cpuLimit === "string" ? parseFloat(opts.cpuLimit) : opts.cpuLimit) * 1e9)
        : undefined,
    };

    const decision = resolveDeploymentStrategy({
      configured: readConfiguredStrategy(opts.applicationConfig),
      hasDomain: !!opts.domains && opts.domains.length > 0,
      isPreview: isPreviewContainer,
      hasPersistentStorage: !!opts.persistentStoragePath,
    });
    log(`Deployment strategy: ${decision.strategy} — ${decision.reason}`);

    if (decision.strategy === "rolling") {
      const result = await rollingDeploy({
        docker: d,
        spec,
        appLabels,
        traefikLabels: traefik.labels,
        applicationId: opts.applicationId,
        appName: opts.appName,
        deploymentId: opts.deploymentId,
        appNameFilter: isPreviewContainer ? opts.appName : undefined,
        healthConfig,
        stopGraceSeconds,
        userId: opts.userId,
        log,
      });

      log(`Container ${result.containerName} is running on port ${result.hostPort}`);
      log(`Access URL: http://localhost:${result.hostPort}`);

      return {
        containerId: result.containerId,
        containerName: result.containerName,
        hostPort: result.hostPort,
        logs,
        strategy: "rolling",
        promotionMode: result.mode,
        candidateContainerId: result.candidateContainerId,
        previousContainerId: result.previousContainerId,
      };
    }

    // ---- Legacy `recreate` path: unchanged behaviour ----
    //
    // The old container is stopped and removed BEFORE the new one is created,
    // so this is a real outage window and a failed start leaves the app down.
    // That is deliberate here: it is the behaviour every existing caller has,
    // and it is what `GS_ZERO_DOWNTIME=0` falls back to.
    log("Cleaning up previous containers...");
    await removeExistingContainers(
      opts.applicationId,
      isPreviewContainer ? { appNameFilter: opts.appName } : undefined,
      d,
    );

    const hostPort = await findAvailablePort(d);
    log(`Assigned host port: ${hostPort}`);

    const containerConfig = buildContainerConfig(spec, {
      name,
      hostPort,
      labels: { ...appLabels, ...traefik.labels },
    });

    log(`Creating container ${name}...`);
    const container = await d.createContainer(containerConfig);

    log("Starting container...");
    await container.start();

    const inspection = await container.inspect();
    if (!inspection.State.Running) {
      throw new Error(`Container failed to start. Status: ${inspection.State.Status}`);
    }

    const startupFailure = await getStartupFailure(container, inspection.RestartCount || 0);
    if (startupFailure) {
      throw new Error(startupFailure);
    }

    log(`Container ${name} is running on port ${hostPort}`);
    log(`Access URL: http://localhost:${hostPort}`);

    return {
      containerId: inspection.Id,
      containerName: name,
      hostPort,
      logs,
      strategy: "recreate",
      promotionMode: "recreate",
      previousContainerId: null,
    };
  } catch (error: any) {
    log(`ERROR: Deployment failed: ${error.message}`);
    if (error instanceof CandidateFailedError && error.incumbentPreserved) {
      log("The previously deployed version was left running and is still serving traffic.");
    }
    throw error;
  }
}

/**
 * Pick the container that is actually serving this application.
 *
 * During a rolling deploy three containers can briefly share `gs.app.id`: the
 * incumbent, the health-gated candidate on an unrouted port, and the promoted
 * replacement. Taking `containers[0]` — whatever Docker happened to list first
 * — meant logs, stats and restart could address the candidate instead of the
 * container serving traffic, so a user watching a deploy could be shown the
 * wrong logs, or restart a container that was about to be discarded.
 *
 * A candidate is never the answer: it is unrouted by construction and exists
 * only until it passes or fails its gate. Among the rest, prefer the
 * most recently started, which is the promoted container once one exists.
 */
export function pickServingContainer(containers: Docker.ContainerInfo[]): Docker.ContainerInfo | null {
  if (containers.length === 0) return null;

  const serving = containers.filter((c) => c.Labels?.[GS_ROLE_LABEL] !== GS_ROLE_CANDIDATE);
  // If everything present is a candidate, the deploy is mid-flight and there is
  // genuinely nothing serving yet. Returning the candidate is better than
  // returning nothing: it is the only container that exists.
  const pool = serving.length > 0 ? serving : containers;

  return pool.reduce((newest, c) => (c.Created > newest.Created ? c : newest), pool[0]);
}

export async function getAppContainer(applicationId: string, dockerClient?: Docker): Promise<Docker.Container | null> {
  const d = dockerClient || docker;
  const containers = await d.listContainers({
    filters: {
      label: [`${GS_LABELS.APP_ID}=${applicationId}`],
      status: ["running"],
    },
  });

  const chosen = pickServingContainer(containers);
  return chosen ? d.getContainer(chosen.Id) : null;
}

export interface ExecResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command inside an existing container and capture its output.
 * Optionally pipe `stdin` (a Buffer) into the process — used to stream a backup
 * dump back into the engine's restore command.
 *
 * `stdout` is returned as a raw Buffer because engine dumps (e.g. pg_dump -Fc,
 * Redis RDB, mongodump archives) are binary.
 */
export async function execInContainer(
  containerId: string,
  cmd: string[],
  options?: {
    stdin?: Buffer;
    /**
     * Environment for the exec, as KEY=value strings. Use this for secrets:
     * a value passed here never becomes part of a shell command string, so it
     * cannot inject a command and does not appear in the process argument list.
     */
    env?: string[];
    dockerClient?: Docker;
  },
): Promise<ExecResult> {
  const d = options?.dockerClient || docker;
  const container = d.getContainer(containerId);
  const hasStdin = !!options?.stdin;

  const exec = await container.exec({
    Cmd: cmd,
    Env: options?.env,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: hasStdin,
  });

  const stream = await exec.start({ hijack: true, stdin: hasStdin });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  // dockerode multiplexes stdout/stderr over a single stream; demux them.
  const stdoutWritable = new Writable({
    write(chunk: Buffer, _enc, next) {
      stdoutChunks.push(chunk);
      next();
    },
  });
  const stderrWritable = new Writable({
    write(chunk: Buffer, _enc, next) {
      stderrChunks.push(chunk);
      next();
    },
  });
  d.modem.demuxStream(stream, stdoutWritable, stderrWritable);

  if (hasStdin && options?.stdin) {
    stream.write(options.stdin);
    stream.end();
  }

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const inspect = await exec.inspect();
  return {
    stdout: Buffer.concat(stdoutChunks),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    exitCode: inspect.ExitCode ?? 0,
  };
}

/**
 * Run a command in a container and hand its stdout back as a stream.
 *
 * execInContainer buffers all of stdout in memory, which is fine for small
 * outputs and wrong for a database dump: a multi-gigabyte dump would be held
 * in the API process whole. Here stdout is a PassThrough the caller pipes
 * onward (to a file, a hash, an upload), and `completed` settles with the exit
 * code and stderr once the command finishes.
 *
 * If `stdin` is given it is piped into the command and closed at its end, so
 * a restore can stream a dump back in without reading it into memory either.
 */
export async function streamExecInContainer(
  containerId: string,
  cmd: string[],
  options?: { env?: string[]; stdin?: NodeJS.ReadableStream; dockerClient?: Docker },
): Promise<{ stdout: PassThrough; completed: Promise<{ exitCode: number; stderr: string }> }> {
  const d = options?.dockerClient || docker;
  const container = d.getContainer(containerId);
  const hasStdin = !!options?.stdin;

  const exec = await container.exec({
    Cmd: cmd,
    Env: options?.env,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: hasStdin,
  });
  const stream = await exec.start({ hijack: true, stdin: hasStdin });

  const stdout = new PassThrough();
  const stderrChunks: Buffer[] = [];
  const stderr = new Writable({
    write(chunk: Buffer, _enc, next) {
      // Keep only the tail: stderr is for diagnostics, not for storing a dump.
      stderrChunks.push(chunk);
      if (stderrChunks.length > 200) stderrChunks.shift();
      next();
    },
  });
  d.modem.demuxStream(stream, stdout, stderr);

  if (hasStdin && options?.stdin) {
    options.stdin.pipe(stream);
  }

  const completed = new Promise<{ exitCode: number; stderr: string }>((resolve, reject) => {
    stream.on("error", (error: Error) => {
      stdout.destroy(error);
      reject(error);
    });
    stream.on("end", async () => {
      stdout.end();
      try {
        const inspect = await exec.inspect();
        resolve({ exitCode: inspect.ExitCode ?? 0, stderr: Buffer.concat(stderrChunks).toString("utf8") });
      } catch (error) {
        reject(error);
      }
    });
  });

  return { stdout, completed };
}

export async function getAppContainerInfo(applicationId: string, dockerClient?: Docker): Promise<ContainerInfo | null> {
  const d = dockerClient || docker;
  const containers = await d.listContainers({
    all: true,
    filters: { label: [`${GS_LABELS.APP_ID}=${applicationId}`] },
  });

  const c = pickServingContainer(containers);
  if (!c) return null;

  return {
    containerId: c.Id,
    containerName: c.Names[0]?.replace("/", "") || "",
    status: c.State,
    ports: (c.Ports || [])
      .filter((p) => p.PublicPort)
      .map((p) => ({ hostPort: p.PublicPort, containerPort: p.PrivatePort })),
    image: c.Image,
    created: new Date(c.Created * 1000),
  };
}

export async function restartContainer(applicationId: string, dockerClient?: Docker): Promise<boolean> {
  const container = await getAppContainer(applicationId, dockerClient);
  if (!container) return false;
  await container.restart({ t: 10 });
  return true;
}

export async function stopContainer(applicationId: string, dockerClient?: Docker): Promise<boolean> {
  const container = await getAppContainer(applicationId, dockerClient);
  if (!container) return false;
  await container.stop({ t: 10 });
  return true;
}

export async function getContainerLogs(applicationId: string, lines = 100, dockerClient?: Docker): Promise<string[]> {
  const d = dockerClient || docker;
  const container = await getAppContainer(applicationId, d);

  const target = container ?? await (async () => {
    const all = await d.listContainers({
      all: true,
      filters: { label: [`${GS_LABELS.APP_ID}=${applicationId}`] },
    });
    return all.length > 0 ? d.getContainer(all[0].Id) : null;
  })();

  if (!target) return [];

  const logBuffer = await target.logs({ stdout: true, stderr: true, tail: lines, timestamps: true });
  return parseDockerLogs(logBuffer);
}

export async function getContainerStats(applicationId: string, dockerClient?: Docker): Promise<ContainerStats | null> {
  const d = dockerClient || docker;
  const container = await getAppContainer(applicationId, d);
  if (!container) return null;

  try {
    const stats = await container.stats({ stream: false });

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

    const memoryUsage = stats.memory_stats.usage || 0;
    const memoryLimit = stats.memory_stats.limit || 0;
    const cacheMemory = stats.memory_stats.stats?.cache || 0;
    const actualMemory = memoryUsage - cacheMemory;

    let networkRx = 0;
    let networkTx = 0;
    if (stats.networks) {
      for (const iface of Object.values(stats.networks) as any[]) {
        networkRx += iface.rx_bytes || 0;
        networkTx += iface.tx_bytes || 0;
      }
    }

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryUsageMb: Math.round((actualMemory / (1024 * 1024)) * 100) / 100,
      memoryLimitMb: Math.round((memoryLimit / (1024 * 1024)) * 100) / 100,
      memoryPercent: memoryLimit > 0 ? Math.round((actualMemory / memoryLimit) * 10000) / 100 : 0,
      networkRxBytes: networkRx,
      networkTxBytes: networkTx,
    };
  } catch (error: any) {
    logger.warn(`Failed to get stats for app ${applicationId}: ${error.message}`);
    return null;
  }
}

export async function listManagedContainers(dockerClient?: Docker): Promise<ContainerInfo[]> {
  const d = dockerClient || docker;
  const containers = await d.listContainers({
    all: true,
    filters: { label: [`${GS_LABELS.MANAGED}=true`] },
  });

  return containers.map((c) => ({
    containerId: c.Id,
    containerName: c.Names[0]?.replace("/", "") || "",
    status: c.State,
    ports: (c.Ports || [])
      .filter((p) => p.PublicPort)
      .map((p) => ({ hostPort: p.PublicPort, containerPort: p.PrivatePort })),
    image: c.Image,
    created: new Date(c.Created * 1000),
  }));
}

export async function testDockerConnection(dockerClient?: Docker): Promise<boolean> {
  const d = dockerClient || docker;
  try {
    await d.ping();
    return true;
  } catch {
    return false;
  }
}
