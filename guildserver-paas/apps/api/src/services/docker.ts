import Docker from "dockerode";
import { logger } from "../utils/logger";
import { broadcastToUser } from "../websocket/server";

// Docker client - connects to local Docker daemon
const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

const NETWORK_NAME = "guildserver";
const CONTAINER_PREFIX = "gs";

// Labels used to track GuildServer-managed containers
export const GS_LABELS = {
  MANAGED: "gs.managed",
  APP_ID: "gs.app.id",
  APP_NAME: "gs.app.name",
  DEPLOYMENT_ID: "gs.deployment.id",
  PROJECT_ID: "gs.project.id",
  TYPE: "gs.type", // "application" | "database"
};

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
  // Domain routing
  domains?: string[];
  containerPort?: number;
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

/**
 * Ensure the GuildServer Docker network exists
 */
export async function ensureNetwork(dockerClient?: Docker): Promise<void> {
  const d = dockerClient || docker;
  try {
    const network = d.getNetwork(NETWORK_NAME);
    await network.inspect();
  } catch {
    logger.info(`Creating Docker network: ${NETWORK_NAME}`);
    await d.createNetwork({
      Name: NETWORK_NAME,
      Driver: "bridge",
    });
  }
}

/**
 * Detect the default internal port for well-known Docker images.
 * Falls back to 80 for unknown images.
 */
function detectDefaultPort(image: string): number {
  const img = image.toLowerCase();

  // Well-known image → default port mappings
  const portMap: Array<[RegExp | string, number]> = [
    [/grafana/, 3000],
    [/ghost/, 2368],
    [/strapi/, 1337],
    [/directus/, 8055],
    [/supabase\/studio/, 3000],
    [/plausible/, 8000],
    [/umami/, 3000],
    [/metabase/, 3000],
    [/minio/, 9000],
    [/gitea/, 3000],
    [/drone/, 80],
    [/nextcloud/, 80],
    [/wordpress/, 80],
    [/jenkins/, 8080],
    [/sonarqube/, 9000],
    [/portainer/, 9000],
    [/uptime-kuma/, 3001],
    [/outline/, 3000],
    [/appsmith/, 80],
    [/n8n/, 5678],
    [/nocodb/, 8080],
    [/hasura/, 8080],
    [/keycloak/, 8080],
    [/verdaccio/, 4873],
    [/registry/, 5000],
    [/traefik/, 8080],
    [/prometheus/, 9090],
    [/alertmanager/, 9093],
    [/node/, 3000],
    [/next/, 3000],
    [/nuxt/, 3000],
    [/remix/, 3000],
    [/vite/, 5173],
    [/flask/, 5000],
    [/django/, 8000],
    [/fastapi/, 8000],
    [/uvicorn/, 8000],
    [/gunicorn/, 8000],
    [/rails/, 3000],
    [/spring/, 8080],
    [/tomcat/, 8080],
    [/wildfly/, 8080],
    [/nginx/, 80],
    [/httpd/, 80],
    [/apache/, 80],
    [/caddy/, 80],
  ];

  for (const [pattern, port] of portMap) {
    if (pattern instanceof RegExp ? pattern.test(img) : img.includes(pattern)) {
      return port;
    }
  }

  // Default: port 80
  return 80;
}

/**
 * Generate a container name from app name and deployment ID
 */
function containerName(appName: string, deploymentId: string): string {
  const shortId = deploymentId.slice(0, 8);
  return `${CONTAINER_PREFIX}-${appName}-${shortId}`;
}

/**
 * Find an available host port in the ephemeral range
 */
async function findAvailablePort(dockerClient?: Docker): Promise<number> {
  const d = dockerClient || docker;
  const MIN_PORT = 10000;
  const MAX_PORT = 60000;
  const usedPorts = new Set<number>();

  // Get ports used by existing containers
  const containers = await d.listContainers({ all: true });
  for (const c of containers) {
    if (c.Ports) {
      for (const p of c.Ports) {
        if (p.PublicPort) usedPorts.add(p.PublicPort);
      }
    }
  }

  // Find a random available port
  for (let attempt = 0; attempt < 100; attempt++) {
    const port = MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT));
    if (!usedPorts.has(port)) return port;
  }

  throw new Error("No available ports found");
}

/**
 * Pull a Docker image with progress streaming
 */
export async function pullImage(
  image: string,
  tag: string,
  userId?: string,
  deploymentId?: string,
  dockerClient?: Docker,
): Promise<string[]> {
  const d = dockerClient || docker;
  // Sanitize image reference — trim whitespace and remove any double-tag
  const cleanImage = image.trim().replace(/:$/, ""); // remove trailing colon
  const cleanTag = tag.trim() || "latest";
  const fullImage = `${cleanImage}:${cleanTag}`;
  const logs: string[] = [];

  const log = (msg: string) => {
    logs.push(msg);
    logger.info(`[pull] ${msg}`);
    if (userId && deploymentId) {
      broadcastToUser(userId, {
        type: "deployment_log",
        deploymentId,
        log: msg,
        phase: "pull",
      });
    }
  };

  log(`Pulling image ${fullImage}...`);

  try {
    const stream = await d.pull(fullImage);

    await new Promise<void>((resolve, reject) => {
      d.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            log(`ERROR: Failed to pull ${fullImage}: ${err.message}`);
            reject(err);
          } else {
            log(`Successfully pulled ${fullImage}`);
            resolve();
          }
        },
        (event: any) => {
          if (event.status) {
            const detail = event.progress ? ` ${event.progress}` : "";
            log(`${event.status}${detail}`);
          }
        }
      );
    });

    return logs;
  } catch (error: any) {
    log(`ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Stop and remove any existing containers for an application
 */
export async function removeExistingContainers(
  applicationId: string,
  options?: { appNameFilter?: string },
  dockerClient?: Docker,
): Promise<void> {
  const d = dockerClient || docker;
  const filters: Record<string, string[]> = {
    label: [`${GS_LABELS.APP_ID}=${applicationId}`],
  };

  // If an appName filter is provided, only remove containers matching that app name
  // This is used for preview deployments to avoid removing the production container
  if (options?.appNameFilter) {
    filters.label.push(`${GS_LABELS.APP_NAME}=${options.appNameFilter}`);
  }

  const containers = await d.listContainers({
    all: true,
    filters,
  });

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

/**
 * Deploy an application as a Docker container
 * This is the main deployment function called by the queue worker
 */
export async function deployContainer(
  opts: DeployOptions,
  dockerClient?: Docker,
): Promise<{
  containerId: string;
  containerName: string;
  hostPort: number;
  logs: string[];
}> {
  const d = dockerClient || docker;
  const logs: string[] = [];
  const name = containerName(opts.appName, opts.deploymentId);

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
    // 1. Ensure network exists
    await ensureNetwork(d);
    log("Docker network ready");

    // 2. Pull the image (skip for locally built images)
    const isLocalImage = opts.dockerImage.startsWith("gs-");
    if (!isLocalImage) {
      const pullLogs = await pullImage(
        opts.dockerImage,
        opts.dockerTag,
        opts.userId,
        opts.deploymentId,
        d,
      );
      logs.push(...pullLogs);
    } else {
      log(`Using locally built image: ${opts.dockerImage}:${opts.dockerTag}`);
    }

    // 3. Remove any existing containers for this application
    // For preview deploys (appName contains "preview"), only remove matching preview containers
    // to avoid taking down production
    const isPreviewContainer = opts.appName.includes("-preview-");
    log("Cleaning up previous containers...");
    await removeExistingContainers(
      opts.applicationId,
      isPreviewContainer ? { appNameFilter: opts.appName } : undefined,
      d,
    );

    // 4. Find an available port
    const hostPort = await findAvailablePort(d);
    log(`Assigned host port: ${hostPort}`);

    // 5. Build container configuration
    const envArray = Object.entries(opts.environment || {}).map(
      ([key, value]) => `${key}=${value}`
    );

    // Sanitize image reference to avoid "invalid reference format" errors
    const cleanImage = opts.dockerImage.trim().replace(/:$/, "");
    const cleanTag = opts.dockerTag.trim() || "latest";
    const fullImage = `${cleanImage}:${cleanTag}`;

    // Build labels (including Traefik routing if domains are configured)
    const labels: Record<string, string> = {
      [GS_LABELS.MANAGED]: "true",
      [GS_LABELS.APP_ID]: opts.applicationId,
      [GS_LABELS.APP_NAME]: opts.appName,
      [GS_LABELS.DEPLOYMENT_ID]: opts.deploymentId,
      [GS_LABELS.PROJECT_ID]: opts.projectId,
      [GS_LABELS.TYPE]: "application",
    };

    // Detect the container's internal port (for Traefik routing + host binding)
    const servicePort = opts.containerPort || detectDefaultPort(cleanImage);
    log(`Using container port: ${servicePort}`);

    // Add Traefik labels for domain routing
    if (opts.domains && opts.domains.length > 0) {
      const routerName = opts.appName.replace(/[^a-zA-Z0-9]/g, "-");

      labels["traefik.enable"] = "true";

      // Separate localhost domains from real (TLS-eligible) domains
      const localhostDomains = opts.domains.filter((dm) => isLocalhostDomain(dm));
      const tlsDomains = opts.domains.filter((dm) => !isLocalhostDomain(dm));

      // Service port (shared by all routers for this container)
      labels[`traefik.http.services.${routerName}.loadbalancer.server.port`] =
        String(servicePort);

      // HTTP router for localhost domains (no TLS)
      if (localhostDomains.length > 0) {
        const localHostRules = localhostDomains
          .map((dm) => `Host(\`${dm}\`)`)
          .join(" || ");
        labels[`traefik.http.routers.${routerName}.rule`] = localHostRules;
        labels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
        labels[`traefik.http.routers.${routerName}.service`] = routerName;
      }

      // HTTPS router for real domains (with TLS via Let's Encrypt)
      if (tlsDomains.length > 0) {
        const tlsRouterName = `${routerName}-secure`;
        const tlsHostRules = tlsDomains
          .map((dm) => `Host(\`${dm}\`)`)
          .join(" || ");

        // Secure router (HTTPS)
        labels[`traefik.http.routers.${tlsRouterName}.rule`] = tlsHostRules;
        labels[`traefik.http.routers.${tlsRouterName}.entrypoints`] = "websecure";
        labels[`traefik.http.routers.${tlsRouterName}.tls`] = "true";
        labels[`traefik.http.routers.${tlsRouterName}.tls.certresolver`] = "letsencrypt";
        labels[`traefik.http.routers.${tlsRouterName}.service`] = routerName;

        // HTTP→HTTPS redirect router for real domains
        const redirectRouterName = `${routerName}-redirect`;
        labels[`traefik.http.routers.${redirectRouterName}.rule`] = tlsHostRules;
        labels[`traefik.http.routers.${redirectRouterName}.entrypoints`] = "web";
        labels[`traefik.http.routers.${redirectRouterName}.middlewares`] = `${routerName}-https-redirect`;
        labels[`traefik.http.routers.${redirectRouterName}.service`] = routerName;
        labels[`traefik.http.middlewares.${routerName}-https-redirect.redirectscheme.scheme`] = "https";
        labels[`traefik.http.middlewares.${routerName}-https-redirect.redirectscheme.permanent`] = "true";

        log(`Configured TLS (Let's Encrypt) for domains: ${tlsDomains.join(", ")}`);
      }

      // Fallback: if only localhost domains, also set up a basic HTTP router
      if (localhostDomains.length === 0 && tlsDomains.length > 0) {
        // All domains are TLS-eligible, no plain HTTP router needed (redirect handles it)
      } else if (localhostDomains.length > 0 && tlsDomains.length === 0) {
        // All domains are localhost, already handled above
      }

      log(`Configured Traefik routing for domains: ${opts.domains.join(", ")}`);
    }

    const containerConfig: Docker.ContainerCreateOptions = {
      Image: fullImage,
      name,
      Env: envArray,
      Labels: labels,
      ExposedPorts: {
        [`${servicePort}/tcp`]: {},
      },
      HostConfig: {
        PortBindings: {
          [`${servicePort}/tcp`]: [{ HostPort: String(hostPort) }],
        },
        RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
        NetworkMode: NETWORK_NAME,
      },
    };

    // Apply resource limits if specified
    if (opts.memoryLimit) {
      containerConfig.HostConfig!.Memory = opts.memoryLimit * 1024 * 1024; // MB to bytes
    }
    if (opts.cpuLimit) {
      // cpuLimit is in cores (e.g., 0.5 = half a core)
      const cpuValue = typeof opts.cpuLimit === "string" ? parseFloat(opts.cpuLimit) : opts.cpuLimit;
      containerConfig.HostConfig!.NanoCpus = Math.floor(cpuValue * 1e9);
    }

    // 6. Create and start the container
    log(`Creating container ${name}...`);
    const container = await d.createContainer(containerConfig);

    log("Starting container...");
    await container.start();

    // 7. Verify the container is running
    const inspection = await container.inspect();
    if (!inspection.State.Running) {
      throw new Error(`Container failed to start. Status: ${inspection.State.Status}`);
    }

    log(`Container ${name} is running on port ${hostPort}`);
    log(`Access URL: http://localhost:${hostPort}`);

    return {
      containerId: inspection.Id,
      containerName: name,
      hostPort,
      logs,
    };
  } catch (error: any) {
    log(`ERROR: Deployment failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get the running container for an application
 */
export async function getAppContainer(
  applicationId: string,
  dockerClient?: Docker,
): Promise<Docker.Container | null> {
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

/**
 * Get container info for an application
 */
export async function getAppContainerInfo(
  applicationId: string,
  dockerClient?: Docker,
): Promise<ContainerInfo | null> {
  const d = dockerClient || docker;
  const containers = await d.listContainers({
    all: true,
    filters: {
      label: [`${GS_LABELS.APP_ID}=${applicationId}`],
    },
  });

  if (containers.length === 0) return null;

  const c = containers[0];
  return {
    containerId: c.Id,
    containerName: c.Names[0]?.replace("/", "") || "",
    status: c.State,
    ports: (c.Ports || [])
      .filter((p) => p.PublicPort)
      .map((p) => ({
        hostPort: p.PublicPort,
        containerPort: p.PrivatePort,
      })),
    image: c.Image,
    created: new Date(c.Created * 1000),
  };
}

/**
 * Restart a container for an application
 */
export async function restartContainer(
  applicationId: string,
  dockerClient?: Docker,
): Promise<boolean> {
  const container = await getAppContainer(applicationId, dockerClient);
  if (!container) return false;

  await container.restart({ t: 10 });
  return true;
}

/**
 * Stop a container for an application
 */
export async function stopContainer(
  applicationId: string,
  dockerClient?: Docker,
): Promise<boolean> {
  const container = await getAppContainer(applicationId, dockerClient);
  if (!container) return false;

  await container.stop({ t: 10 });
  return true;
}

/**
 * Get real-time logs from a running container
 */
export async function getContainerLogs(
  applicationId: string,
  lines: number = 100,
  dockerClient?: Docker,
): Promise<string[]> {
  const d = dockerClient || docker;
  const container = await getAppContainer(applicationId, d);
  if (!container) {
    // Try to get stopped container
    const containers = await d.listContainers({
      all: true,
      filters: {
        label: [`${GS_LABELS.APP_ID}=${applicationId}`],
      },
    });
    if (containers.length === 0) return [];
    const stoppedContainer = d.getContainer(containers[0].Id);
    const logBuffer = await stoppedContainer.logs({
      stdout: true,
      stderr: true,
      tail: lines,
      timestamps: true,
    });
    return parseDockerLogs(logBuffer);
  }

  const logBuffer = await container.logs({
    stdout: true,
    stderr: true,
    tail: lines,
    timestamps: true,
  });

  return parseDockerLogs(logBuffer);
}

/**
 * Parse Docker log buffer into lines
 * Docker multiplexed stream has 8-byte header per frame
 */
function parseDockerLogs(buffer: Buffer | string): string[] {
  if (typeof buffer === "string") {
    return buffer.split("\n").filter((line) => line.trim());
  }

  const lines: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;

    // Read frame header: [stream_type(1), 0(3), size(4)]
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + size > buffer.length) break;

    const line = buffer.subarray(offset, offset + size).toString("utf8").trim();
    if (line) lines.push(line);
    offset += size;
  }

  return lines;
}

/**
 * Get real CPU/memory stats from a running container
 */
export async function getContainerStats(
  applicationId: string,
  dockerClient?: Docker,
): Promise<ContainerStats | null> {
  const d = dockerClient || docker;
  const container = await getAppContainer(applicationId, d);
  if (!container) return null;

  try {
    const stats = await container.stats({ stream: false });

    // Calculate CPU percentage
    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta =
      stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

    // Calculate memory
    const memoryUsage = stats.memory_stats.usage || 0;
    const memoryLimit = stats.memory_stats.limit || 0;
    const cacheMemory = stats.memory_stats.stats?.cache || 0;
    const actualMemory = memoryUsage - cacheMemory;

    // Calculate network I/O
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

/**
 * List all GuildServer-managed containers
 */
export async function listManagedContainers(dockerClient?: Docker): Promise<ContainerInfo[]> {
  const d = dockerClient || docker;
  const containers = await d.listContainers({
    all: true,
    filters: {
      label: [`${GS_LABELS.MANAGED}=true`],
    },
  });

  return containers.map((c) => ({
    containerId: c.Id,
    containerName: c.Names[0]?.replace("/", "") || "",
    status: c.State,
    ports: (c.Ports || [])
      .filter((p) => p.PublicPort)
      .map((p) => ({
        hostPort: p.PublicPort,
        containerPort: p.PrivatePort,
      })),
    image: c.Image,
    created: new Date(c.Created * 1000),
  }));
}

/**
 * Test Docker connectivity
 */
export async function testDockerConnection(dockerClient?: Docker): Promise<boolean> {
  const d = dockerClient || docker;
  try {
    await d.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a domain is a localhost/dev domain (no TLS needed)
 */
export function isLocalhostDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    d === "localhost" ||
    d.endsWith(".localhost") ||
    d.endsWith(".local") ||
    d.endsWith(".test") ||
    d.endsWith(".example") ||
    d === "127.0.0.1" ||
    d.startsWith("192.168.") ||
    d.startsWith("10.") ||
    d.startsWith("172.16.")
  );
}

/**
 * Get the Docker client instance (for advanced operations)
 */
export function getDockerClient(): Docker {
  return docker;
}
