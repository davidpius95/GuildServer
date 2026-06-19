import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { broadcastToUser } from "../../websocket/server";
import { docker, NETWORK_NAME, CONTAINER_PREFIX, GS_LABELS, isLocalhostDomain } from "./client";
import { ensureNetwork } from "./networks";
import { pullImage, detectDefaultPort } from "./images";

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
  registryAuth?: { username: string; password: string; serveraddress?: string };
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

function makeContainerName(appName: string, deploymentId: string): string {
  const shortId = deploymentId.slice(0, 8);
  return `${CONTAINER_PREFIX}-${appName}-${shortId}`;
}

async function findAvailablePort(dockerClient?: Docker): Promise<number> {
  const d = dockerClient || docker;
  const MIN_PORT = 10000;
  const MAX_PORT = 60000;
  const usedPorts = new Set<number>();

  const containers = await d.listContainers({ all: true });
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

function parseDockerLogs(buffer: Buffer | string): string[] {
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
): Promise<{ containerId: string; containerName: string; hostPort: number; logs: string[] }> {
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
    log("Cleaning up previous containers...");
    await removeExistingContainers(
      opts.applicationId,
      isPreviewContainer ? { appNameFilter: opts.appName } : undefined,
      d,
    );

    const hostPort = await findAvailablePort(d);
    log(`Assigned host port: ${hostPort}`);

    const envArray = Object.entries(opts.environment || {}).map(([key, value]) => `${key}=${value}`);
    const cleanImage = opts.dockerImage.trim().replace(/:$/, "");
    const cleanTag = opts.dockerTag.trim() || "latest";
    const fullImage = `${cleanImage}:${cleanTag}`;

    const labels: Record<string, string> = {
      [GS_LABELS.MANAGED]: "true",
      [GS_LABELS.APP_ID]: opts.applicationId,
      [GS_LABELS.APP_NAME]: opts.appName,
      [GS_LABELS.DEPLOYMENT_ID]: opts.deploymentId,
      [GS_LABELS.PROJECT_ID]: opts.projectId,
      [GS_LABELS.TYPE]: "application",
    };

    const servicePort = opts.containerPort || detectDefaultPort(cleanImage);
    log(`Using container port: ${servicePort}`);

    if (opts.domains && opts.domains.length > 0) {
      const routerName = opts.appName.replace(/[^a-zA-Z0-9]/g, "-");
      labels["traefik.enable"] = "true";

      const localhostDomains = opts.domains.filter((dm) => isLocalhostDomain(dm));
      const tlsDomains = opts.domains.filter((dm) => !isLocalhostDomain(dm));

      labels[`traefik.http.services.${routerName}.loadbalancer.server.port`] = String(servicePort);

      if (localhostDomains.length > 0) {
        const localHostRules = localhostDomains.map((dm) => `Host(\`${dm}\`)`).join(" || ");
        labels[`traefik.http.routers.${routerName}.rule`] = localHostRules;
        labels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
        labels[`traefik.http.routers.${routerName}.service`] = routerName;
      }

      if (tlsDomains.length > 0) {
        const tlsHostRules = tlsDomains.map((dm) => `Host(\`${dm}\`)`).join(" || ");
        const behindTunnel = process.env.CLOUDFLARE_TUNNEL === "true";

        if (behindTunnel) {
          labels[`traefik.http.routers.${routerName}.rule`] = tlsHostRules;
          labels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
          labels[`traefik.http.routers.${routerName}.service`] = routerName;
          log(`Configured HTTP routing (behind Cloudflare Tunnel) for domains: ${tlsDomains.join(", ")}`);
        } else {
          const tlsRouterName = `${routerName}-secure`;
          labels[`traefik.http.routers.${tlsRouterName}.rule`] = tlsHostRules;
          labels[`traefik.http.routers.${tlsRouterName}.entrypoints`] = "websecure";
          labels[`traefik.http.routers.${tlsRouterName}.tls`] = "true";
          labels[`traefik.http.routers.${tlsRouterName}.tls.certresolver`] = "letsencrypt";
          labels[`traefik.http.routers.${tlsRouterName}.service`] = routerName;

          const redirectRouterName = `${routerName}-redirect`;
          labels[`traefik.http.routers.${redirectRouterName}.rule`] = tlsHostRules;
          labels[`traefik.http.routers.${redirectRouterName}.entrypoints`] = "web";
          labels[`traefik.http.routers.${redirectRouterName}.middlewares`] = `${routerName}-https-redirect`;
          labels[`traefik.http.routers.${redirectRouterName}.service`] = routerName;
          labels[`traefik.http.middlewares.${routerName}-https-redirect.redirectscheme.scheme`] = "https";
          labels[`traefik.http.middlewares.${routerName}-https-redirect.redirectscheme.permanent`] = "true";
          log(`Configured TLS (Let's Encrypt) for domains: ${tlsDomains.join(", ")}`);
        }
      }

      log(`Configured Traefik routing for domains: ${opts.domains.join(", ")}`);
    }

    const containerConfig: Docker.ContainerCreateOptions = {
      Image: fullImage,
      name,
      Env: envArray,
      Labels: labels,
      ExposedPorts: { [`${servicePort}/tcp`]: {} },
      HostConfig: {
        PortBindings: { [`${servicePort}/tcp`]: [{ HostPort: String(hostPort) }] },
        RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
        NetworkMode: NETWORK_NAME,
      },
    };

    if (opts.memoryLimit) {
      containerConfig.HostConfig!.Memory = opts.memoryLimit * 1024 * 1024;
    }
    if (opts.cpuLimit) {
      const cpuValue = typeof opts.cpuLimit === "string" ? parseFloat(opts.cpuLimit) : opts.cpuLimit;
      containerConfig.HostConfig!.NanoCpus = Math.floor(cpuValue * 1e9);
    }

    log(`Creating container ${name}...`);
    const container = await d.createContainer(containerConfig);

    log("Starting container...");
    await container.start();

    const inspection = await container.inspect();
    if (!inspection.State.Running) {
      throw new Error(`Container failed to start. Status: ${inspection.State.Status}`);
    }

    log(`Container ${name} is running on port ${hostPort}`);
    log(`Access URL: http://localhost:${hostPort}`);

    return { containerId: inspection.Id, containerName: name, hostPort, logs };
  } catch (error: any) {
    log(`ERROR: Deployment failed: ${error.message}`);
    throw error;
  }
}

export async function getAppContainer(applicationId: string, dockerClient?: Docker): Promise<Docker.Container | null> {
  const d = dockerClient || docker;
  const containers = await d.listContainers({
    filters: {
      label: [`${GS_LABELS.APP_ID}=${applicationId}`],
      status: ["running"],
    },
  });

  if (containers.length === 0) return null;
  return d.getContainer(containers[0].Id);
}

export async function getAppContainerInfo(applicationId: string, dockerClient?: Docker): Promise<ContainerInfo | null> {
  const d = dockerClient || docker;
  const containers = await d.listContainers({
    all: true,
    filters: { label: [`${GS_LABELS.APP_ID}=${applicationId}`] },
  });

  if (containers.length === 0) return null;

  const c = containers[0];
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
