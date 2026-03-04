import {
  ComputeProvider,
  DeployConfig,
  DeployResult,
  WorkloadInfo,
  WorkloadMetrics,
  HealthResult,
  ConnectionTestResult,
  ProxmoxConfig,
  ProviderType,
} from "./types";
import { ProxmoxClient } from "../services/proxmox-client";
import type { NetworkInterface } from "../services/proxmox-client";
import {
  getDockerClient,
  removeClientByHost,
  waitForDockerReady,
  testDockerClient,
} from "../services/node-docker";
import {
  deployContainer,
  pullImage,
  removeExistingContainers,
  getAppContainer,
  getAppContainerInfo,
  getContainerLogs,
  getContainerStats,
  stopContainer,
  restartContainer,
} from "../services/docker";
import type { DeployOptions } from "../services/docker";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix used for GuildServer-managed LXC hostnames. */
const HOSTNAME_PREFIX = "gs-";

/** Default rootfs size in GB for new LXC containers. */
const DEFAULT_ROOTFS_GB = 8;

/** Default memory limit in MB when none is specified. */
const DEFAULT_MEMORY_MB = 512;

/** Default CPU cores when none is specified. */
const DEFAULT_CORES = 1;

/** Maximum time (ms) to wait for an LXC container to obtain an IP address. */
const IP_WAIT_TIMEOUT_MS = 60_000;

/** Polling interval (ms) when waiting for an LXC IP address. */
const IP_POLL_INTERVAL_MS = 2_000;

/** Maximum time (ms) to wait for a Proxmox task to complete. */
const TASK_TIMEOUT_MS = 120_000;

/** Maximum time (ms) to wait for Docker daemon inside LXC to become ready. */
const DOCKER_READY_TIMEOUT_MS = 60_000;

/** Default Docker TCP port exposed inside the LXC. */
const DOCKER_TCP_PORT = 2375;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an application name into a valid LXC hostname.
 *
 * LXC hostnames must consist of alphanumeric characters and hyphens only,
 * cannot start or end with a hyphen, and are limited to 63 characters.
 */
function sanitizeHostname(appName: string): string {
  const cleaned = appName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // replace invalid chars with hyphens
    .replace(/-+/g, "-")          // collapse consecutive hyphens
    .replace(/^-+|-+$/g, "");     // trim leading/trailing hyphens

  // Ensure we have something left after sanitization
  const base = cleaned || "app";

  // Prefix with "gs-" so we can identify GuildServer-managed containers
  const hostname = `${HOSTNAME_PREFIX}${base}`;

  // Truncate to 63 characters (max hostname length)
  return hostname.slice(0, 63);
}

/**
 * Parse the memory limit from a DeployConfig value into megabytes.
 */
function parseMemoryMb(memoryLimit: number | null | undefined): number {
  if (memoryLimit == null || memoryLimit <= 0) return DEFAULT_MEMORY_MB;
  // If the value is already in MB range, use as-is.
  // If it looks like bytes (>= 1 000 000), convert to MB.
  if (memoryLimit >= 1_000_000) {
    return Math.round(memoryLimit / (1024 * 1024));
  }
  return memoryLimit;
}

/**
 * Parse the CPU limit from a DeployConfig value into a core count.
 */
function parseCpuCores(cpuLimit: number | string | null | undefined): number {
  if (cpuLimit == null) return DEFAULT_CORES;
  const n = typeof cpuLimit === "string" ? parseFloat(cpuLimit) : cpuLimit;
  if (isNaN(n) || n <= 0) return DEFAULT_CORES;
  // Round up fractional cores — LXC requires whole-number core counts.
  return Math.max(1, Math.ceil(n));
}

/**
 * Extract the first non-loopback IPv4 address from an LXC's network
 * interfaces response.
 */
function extractIPv4(interfaces: NetworkInterface[]): string | null {
  for (const iface of interfaces) {
    // Skip loopback
    if (iface.name === "lo") continue;
    const addrs = iface["ip-addresses"];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr["ip-address-type"] === "inet") {
        return addr["ip-address"];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * ProxmoxProvider deploys customer applications as Docker containers running
 * inside Proxmox VE LXC containers.
 *
 * Deployment strategy:
 *   1. Create an LXC container from an Ubuntu template with Docker
 *      pre-installed (or at least an Ubuntu template where Docker can be
 *      bootstrapped).
 *   2. Enable `nesting=1` features on the LXC so Docker-in-LXC works.
 *   3. Start the LXC and wait for it to acquire an IP address via DHCP.
 *   4. Connect to the Docker daemon inside the LXC via TCP (port 2375).
 *   5. Pull the application image and run it as a Docker container.
 *   6. Record the VMID, IP, and Docker container ID in provider metadata.
 */
export class ProxmoxProvider implements ComputeProvider {
  readonly type: ProviderType = "proxmox";
  private client: ProxmoxClient;
  private config: ProxmoxConfig;
  private providerId?: string;

  constructor(config: ProxmoxConfig, providerId?: string) {
    this.config = config;
    this.providerId = providerId;
    this.client = new ProxmoxClient({
      host: config.host,
      port: config.port || 8006,
      tokenId: config.tokenId,
      tokenSecret: config.tokenSecret,
      allowInsecure: true, // Proxmox often uses self-signed certs
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async deploy(config: DeployConfig): Promise<DeployResult> {
    const node = this.config.node;
    const storage = this.config.storage || "local-lvm";
    const bridge = this.config.bridge || "vmbr0";
    const hostname = sanitizeHostname(config.appName);
    const memoryMb = parseMemoryMb(config.memoryLimit);
    const cores = parseCpuCores(config.cpuLimit);
    const logs: string[] = [];

    logger.info("Proxmox deploy starting", {
      applicationId: config.applicationId,
      deploymentId: config.deploymentId,
      hostname,
      node,
      image: `${config.dockerImage}:${config.dockerTag}`,
    });

    // ------------------------------------------------------------------
    // 1. Resolve the OS template
    // ------------------------------------------------------------------
    const ostemplate = await this.resolveTemplate(node, storage);
    logs.push(`Using OS template: ${ostemplate}`);
    logger.info("Resolved OS template", { ostemplate });

    // ------------------------------------------------------------------
    // 2. Allocate a VMID
    // ------------------------------------------------------------------
    const vmid = await this.client.getNextVMID();
    logs.push(`Allocated VMID: ${vmid}`);
    logger.info("Allocated VMID", { vmid });

    // ------------------------------------------------------------------
    // 3. Create the LXC container
    // ------------------------------------------------------------------
    const rootfs = `${storage}:${DEFAULT_ROOTFS_GB}`;
    const net0 = `name=eth0,bridge=${bridge},ip=dhcp`;

    logs.push(
      `Creating LXC: vmid=${vmid}, memory=${memoryMb}MB, cores=${cores}, rootfs=${rootfs}`,
    );

    const createUpid = await this.client.createLXC(node, {
      vmid,
      hostname,
      ostemplate,
      storage,
      rootfs,
      memory: memoryMb,
      swap: Math.round(memoryMb / 2),
      cores,
      net0,
      start: false,
      unprivileged: true,
      features: "nesting=1",
      onboot: true,
    });

    logger.info("LXC creation task submitted", { vmid, upid: createUpid });

    // Wait for the creation task to finish
    const createResult = await this.client.waitForTask(
      node,
      createUpid,
      TASK_TIMEOUT_MS,
    );

    if (createResult.status !== "OK") {
      const errMsg = `LXC creation failed: ${createResult.exitstatus || "unknown error"}`;
      logger.error(errMsg, { vmid, createResult });
      throw new Error(errMsg);
    }

    logs.push("LXC container created successfully");
    logger.info("LXC container created", { vmid });

    // ------------------------------------------------------------------
    // 4. Start the LXC
    // ------------------------------------------------------------------
    const startUpid = await this.client.startLXC(node, vmid);
    logger.info("LXC start task submitted", { vmid, upid: startUpid });

    const startResult = await this.client.waitForTask(
      node,
      startUpid,
      TASK_TIMEOUT_MS,
    );

    if (startResult.status !== "OK") {
      const errMsg = `LXC start failed: ${startResult.exitstatus || "unknown error"}`;
      logger.error(errMsg, { vmid, startResult });
      throw new Error(errMsg);
    }

    logs.push("LXC container started");
    logger.info("LXC container started", { vmid });

    // ------------------------------------------------------------------
    // 5. Wait for the LXC to obtain an IP address
    // ------------------------------------------------------------------
    let lxcIp: string | null = null;
    try {
      lxcIp = await this.waitForLXCIP(node, vmid, IP_WAIT_TIMEOUT_MS);
      logs.push(`LXC obtained IP address: ${lxcIp}`);
      logger.info("LXC obtained IP", { vmid, lxcIp });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown error waiting for IP";
      logs.push(`Warning: ${msg}`);
      logger.warn("Failed to obtain LXC IP within timeout", { vmid, error: msg });
      // We don't throw here — the LXC is created and running, just no IP yet.
      // The user can check Proxmox web UI or retry later.
    }

    // ------------------------------------------------------------------
    // 6. Deploy Docker container inside the LXC
    // ------------------------------------------------------------------
    const containerPort = config.containerPort || 3000;
    let dockerContainerId: string | null = null;
    let dockerContainerName: string | null = null;
    let dockerHostPort = 0;

    if (lxcIp) {
      try {
        // Connect to the Docker daemon inside the LXC via TCP
        const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);

        logs.push(`Connecting to Docker daemon at ${lxcIp}:${DOCKER_TCP_PORT}...`);
        logger.info("Waiting for Docker daemon in LXC", { vmid, lxcIp });

        await waitForDockerReady(remoteDocker, DOCKER_READY_TIMEOUT_MS);
        logs.push("Docker daemon is ready inside LXC");

        // Pull the image on the remote Docker daemon
        const pullLogs = await pullImage(
          config.dockerImage,
          config.dockerTag,
          config.userId,
          config.deploymentId,
          remoteDocker,
        );
        logs.push(...pullLogs);

        // Deploy the application container inside the LXC
        const deployOpts: DeployOptions = {
          deploymentId: config.deploymentId,
          applicationId: config.applicationId,
          appName: config.appName,
          projectId: config.projectId,
          userId: config.userId,
          dockerImage: config.dockerImage,
          dockerTag: config.dockerTag,
          environment: config.environment,
          memoryLimit: config.memoryLimit,
          cpuLimit: config.cpuLimit,
          replicas: config.replicas,
          sourceType: config.sourceType,
          domains: config.domains,
          containerPort: config.containerPort,
        };

        const deployResult = await deployContainer(deployOpts, remoteDocker);
        dockerContainerId = deployResult.containerId;
        dockerContainerName = deployResult.containerName;
        dockerHostPort = deployResult.hostPort;
        logs.push(...deployResult.logs);

        logger.info("Docker container deployed inside LXC", {
          vmid,
          lxcIp,
          containerId: dockerContainerId,
          hostPort: dockerHostPort,
        });
      } catch (dockerErr) {
        const msg = dockerErr instanceof Error ? dockerErr.message : String(dockerErr);
        logs.push(
          `Warning: Docker deployment inside LXC failed: ${msg}. ` +
          "The LXC is running and ready for manual Docker setup.",
        );
        logger.warn("Docker deployment inside LXC failed", {
          vmid,
          lxcIp,
          error: msg,
        });
        // Don't throw — the LXC is created and running, Docker can be
        // set up manually or retried later.
      }
    } else {
      logs.push(
        "Note: Could not deploy Docker container — no LXC IP address available. " +
        "The LXC is running and ready for manual Docker setup.",
      );
    }

    const resultContainerName = dockerContainerName || `pve-${vmid}`;

    logger.info("Proxmox deploy completed", {
      applicationId: config.applicationId,
      vmid,
      hostname,
      lxcIp,
      dockerContainerId,
      dockerHostPort,
    });

    return {
      containerId: dockerContainerId || resultContainerName,
      containerName: resultContainerName,
      hostPort: dockerHostPort,
      logs,
      providerMetadata: {
        provider: "proxmox",
        vmid,
        node,
        hostname,
        lxcIp: lxcIp || null,
        storage,
        bridge,
        dockerContainerId: dockerContainerId || null,
        dockerContainerName: dockerContainerName || null,
        dockerHostPort,
        dockerConfig: {
          image: config.dockerImage,
          tag: config.dockerTag,
          containerPort,
          environment: config.environment,
        },
      },
    };
  }

  async stop(applicationId: string): Promise<void> {
    const node = this.config.node;
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      logger.warn("Cannot stop: no LXC found for application", { applicationId });
      throw new Error(
        `No Proxmox LXC container found for application ${applicationId}`,
      );
    }

    // Try to stop the Docker container inside the LXC first
    await this.stopDockerContainer(applicationId, node, vmid);

    // Then stop the LXC itself
    logger.info("Stopping LXC", { applicationId, vmid, node });

    const upid = await this.client.stopLXC(node, vmid);
    const result = await this.client.waitForTask(node, upid, TASK_TIMEOUT_MS);

    if (result.status !== "OK") {
      const errMsg = `Failed to stop LXC ${vmid}: ${result.exitstatus || "unknown error"}`;
      logger.error(errMsg, { vmid, result });
      throw new Error(errMsg);
    }

    logger.info("LXC stopped", { applicationId, vmid });
  }

  async restart(applicationId: string): Promise<boolean> {
    const node = this.config.node;
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      logger.warn("Cannot restart: no LXC found for application", {
        applicationId,
      });
      return false;
    }

    logger.info("Restarting LXC", { applicationId, vmid, node });

    try {
      // Check current status to decide whether we need to stop first
      const status = await this.client.getLXCStatus(node, vmid);

      if (status.status === "running") {
        // Try to restart the Docker container inside the LXC
        const dockerRestarted = await this.restartDockerContainer(applicationId, node, vmid);
        if (dockerRestarted) {
          logger.info("Docker container restarted inside LXC (LXC stayed running)", {
            applicationId, vmid,
          });
          return true;
        }

        // If Docker restart failed, fall back to full LXC restart
        const stopUpid = await this.client.stopLXC(node, vmid);
        const stopResult = await this.client.waitForTask(
          node,
          stopUpid,
          TASK_TIMEOUT_MS,
        );
        if (stopResult.status !== "OK") {
          logger.error("Failed to stop LXC during restart", {
            vmid,
            stopResult,
          });
          return false;
        }
      }

      // Start
      const startUpid = await this.client.startLXC(node, vmid);
      const startResult = await this.client.waitForTask(
        node,
        startUpid,
        TASK_TIMEOUT_MS,
      );

      if (startResult.status !== "OK") {
        logger.error("Failed to start LXC during restart", {
          vmid,
          startResult,
        });
        return false;
      }

      logger.info("LXC restarted successfully", { applicationId, vmid });
      return true;
    } catch (err) {
      logger.error("Error restarting LXC", {
        applicationId,
        vmid,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async remove(applicationId: string): Promise<void> {
    const node = this.config.node;
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      logger.warn("Cannot remove: no LXC found for application", {
        applicationId,
      });
      // Don't throw — idempotent removal. If it's already gone, that's fine.
      return;
    }

    logger.info("Removing LXC", { applicationId, vmid, node });

    // Clean up the cached Docker client for this LXC
    const lxcIp = await this.getLXCIP(node, vmid);
    if (lxcIp) {
      removeClientByHost(lxcIp, DOCKER_TCP_PORT);
    }

    try {
      // Ensure the container is stopped before destroying
      const status = await this.client.getLXCStatus(node, vmid);

      if (status.status === "running") {
        logger.info("Stopping LXC before destruction", { vmid });
        const stopUpid = await this.client.stopLXC(node, vmid);
        await this.client.waitForTask(node, stopUpid, TASK_TIMEOUT_MS);
      }
    } catch (err) {
      // If we can't get status or stop, the container may already be stopped
      // or partially removed. Continue with destruction.
      logger.warn("Could not stop LXC before destroy (may already be stopped)", {
        vmid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Destroy the container
    const destroyUpid = await this.client.destroyLXC(node, vmid);
    const destroyResult = await this.client.waitForTask(
      node,
      destroyUpid,
      TASK_TIMEOUT_MS,
    );

    if (destroyResult.status !== "OK") {
      const errMsg = `Failed to destroy LXC ${vmid}: ${destroyResult.exitstatus || "unknown error"}`;
      logger.error(errMsg, { vmid, destroyResult });
      throw new Error(errMsg);
    }

    logger.info("LXC destroyed", { applicationId, vmid });
  }

  // -------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------

  async getLogs(applicationId: string, lines?: number): Promise<string[]> {
    const node = this.config.node;
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      return [
        `No Proxmox LXC container found for application ${applicationId}.`,
      ];
    }

    // Try to get logs from the Docker container inside the LXC
    const lxcIp = await this.getLXCIP(node, vmid);
    if (lxcIp) {
      try {
        const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);
        const isReady = await testDockerClient(remoteDocker);
        if (isReady) {
          const dockerLogs = await getContainerLogs(applicationId, lines, remoteDocker);
          if (dockerLogs.length > 0) {
            return dockerLogs;
          }
        }
      } catch (err) {
        logger.debug("Failed to get Docker logs from LXC, falling back to info", {
          vmid, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fallback: informational message
    return [
      `Logs for LXC VMID ${vmid} on node ${this.config.node}:`,
      "",
      "Direct log retrieval is not available — Docker daemon inside LXC may not be reachable.",
      "To view logs, use one of the following methods:",
      `  1. Proxmox Web UI: https://${this.config.host}:${this.config.port || 8006}`,
      `  2. SSH into the LXC and run: docker logs app`,
      `  3. From the Proxmox host: pct exec ${vmid} -- docker logs app`,
    ];
  }

  async getMetrics(applicationId: string): Promise<WorkloadMetrics | null> {
    const node = this.config.node;
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      logger.warn("Cannot get metrics: no LXC found for application", {
        applicationId,
      });
      return null;
    }

    // Try to get Docker container metrics first (more accurate for the app)
    const lxcIp = await this.getLXCIP(node, vmid);
    if (lxcIp) {
      try {
        const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);
        const isReady = await testDockerClient(remoteDocker);
        if (isReady) {
          const stats = await getContainerStats(applicationId, remoteDocker);
          if (stats) {
            return {
              cpuPercent: stats.cpuPercent,
              memoryUsageMb: stats.memoryUsageMb,
              memoryLimitMb: stats.memoryLimitMb,
              memoryPercent: stats.memoryPercent,
              networkRxBytes: stats.networkRxBytes,
              networkTxBytes: stats.networkTxBytes,
            };
          }
        }
      } catch (err) {
        logger.debug("Failed to get Docker metrics from LXC, falling back to LXC metrics", {
          vmid, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fallback: LXC-level metrics from Proxmox API
    try {
      const status = await this.client.getLXCStatus(node, vmid);

      // The LXC status gives us resource usage for the entire LXC.
      // This is a reasonable proxy for the app container inside it.
      const memoryUsageMb = Math.round(status.mem / (1024 * 1024));
      const memoryLimitMb = Math.round(status.maxmem / (1024 * 1024));
      const memoryPercent =
        memoryLimitMb > 0 ? (memoryUsageMb / memoryLimitMb) * 100 : 0;

      // Proxmox reports CPU as a fraction (0.0 - 1.0 per core).
      // Convert to percentage relative to allocated cores.
      const cpuPercent =
        status.maxcpu > 0 ? (status.cpu / status.maxcpu) * 100 : 0;

      return {
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        memoryUsageMb,
        memoryLimitMb,
        memoryPercent: Math.round(memoryPercent * 100) / 100,
        networkRxBytes: status.netin || 0,
        networkTxBytes: status.netout || 0,
      };
    } catch (err) {
      logger.error("Failed to get LXC metrics", {
        applicationId,
        vmid,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async getInfo(applicationId: string): Promise<WorkloadInfo | null> {
    const node = this.config.node;
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      logger.warn("Cannot get info: no LXC found for application", {
        applicationId,
      });
      return null;
    }

    try {
      const status = await this.client.getLXCStatus(node, vmid);

      // Attempt to get the LXC's IP address
      let lxcIp: string | null = null;
      if (status.status === "running") {
        lxcIp = await this.getLXCIP(node, vmid);
      }

      // Try to get Docker container info for richer details
      if (lxcIp) {
        try {
          const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);
          const isReady = await testDockerClient(remoteDocker);
          if (isReady) {
            const dockerInfo = await getAppContainerInfo(applicationId, remoteDocker);
            if (dockerInfo) {
              return {
                ...dockerInfo,
                providerMetadata: {
                  provider: "proxmox",
                  vmid,
                  node,
                  lxcIp,
                  uptime: status.uptime,
                  pid: status.pid,
                  dockerContainerId: dockerInfo.containerId,
                  dockerContainerName: dockerInfo.containerName,
                },
              };
            }
          }
        } catch (err) {
          logger.debug("Failed to get Docker info from LXC", {
            vmid, error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Fallback: LXC-level info
      return {
        containerId: `pve-${vmid}`,
        containerName: status.name || `pve-${vmid}`,
        status: status.status,
        ports: lxcIp
          ? [{ hostPort: 0, containerPort: 0 }] // Proxmox doesn't have host port mapping
          : [],
        image: `lxc/${status.name || "unknown"}`,
        created: new Date(), // Proxmox status doesn't include creation time directly
        providerMetadata: {
          provider: "proxmox",
          vmid,
          node,
          lxcIp,
          uptime: status.uptime,
          pid: status.pid,
        },
      };
    } catch (err) {
      logger.error("Failed to get LXC info", {
        applicationId,
        vmid,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async healthCheck(applicationId: string): Promise<HealthResult> {
    const node = this.config.node;
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      return {
        healthy: false,
        status: "not_found",
        message: `No Proxmox LXC container found for application ${applicationId}`,
        checkedAt: new Date(),
      };
    }

    try {
      const status = await this.client.getLXCStatus(node, vmid);
      const lxcRunning = status.status === "running";

      if (!lxcRunning) {
        return {
          healthy: false,
          status: status.status,
          message: `LXC ${vmid} (${status.name}) is ${status.status}`,
          checkedAt: new Date(),
        };
      }

      // LXC is running — also check Docker container inside it
      const lxcIp = await this.getLXCIP(node, vmid);
      if (lxcIp) {
        try {
          const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);
          const isReady = await testDockerClient(remoteDocker);
          if (isReady) {
            const container = await getAppContainer(applicationId, remoteDocker);
            if (container) {
              const inspection = await container.inspect();
              const dockerRunning = inspection.State.Running;

              return {
                healthy: dockerRunning,
                status: dockerRunning ? "running" : inspection.State.Status,
                message: dockerRunning
                  ? `Docker container running inside LXC ${vmid} (uptime: ${formatUptime(status.uptime)})`
                  : `Docker container ${inspection.State.Status} inside LXC ${vmid}`,
                checkedAt: new Date(),
              };
            }
          }
        } catch {
          // Docker check failed, fall back to LXC-level health
        }
      }

      // LXC is running but we couldn't check Docker
      return {
        healthy: lxcRunning,
        status: status.status,
        message: `LXC ${vmid} (${status.name}) is running (uptime: ${formatUptime(status.uptime)})`,
        checkedAt: new Date(),
      };
    } catch (err) {
      return {
        healthy: false,
        status: "error",
        message: `Failed to check LXC ${vmid}: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt: new Date(),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<ConnectionTestResult> {
    const result = await this.client.testConnection();

    if (!result.connected) {
      return {
        connected: false,
        message: result.message,
      };
    }

    // Enrich with node resource info if available
    let resources:
      | { cpuCores?: number; memoryMb?: number; storageMb?: number }
      | undefined;

    try {
      const nodeStatus = await this.client.getNodeStatus(this.config.node);
      resources = {
        cpuCores: nodeStatus.maxcpu,
        memoryMb: Math.round(nodeStatus.maxmem / (1024 * 1024)),
        storageMb: Math.round(nodeStatus.maxdisk / (1024 * 1024)),
      };
    } catch {
      // Node status is optional enrichment; don't fail the connection test.
    }

    return {
      connected: true,
      message: result.message,
      details: {
        version: result.version,
        resources,
        nodeCount: result.nodes,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers — Docker container management inside LXC
  // -------------------------------------------------------------------------

  /**
   * Try to stop the Docker container inside the LXC before stopping the LXC.
   * This ensures a graceful shutdown of the application.
   */
  private async stopDockerContainer(
    applicationId: string,
    node: string,
    vmid: number,
  ): Promise<void> {
    const lxcIp = await this.getLXCIP(node, vmid);
    if (!lxcIp) return;

    try {
      const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);
      const isReady = await testDockerClient(remoteDocker);
      if (isReady) {
        await stopContainer(applicationId, remoteDocker);
        logger.info("Docker container stopped inside LXC", { applicationId, vmid });
      }
    } catch (err) {
      logger.debug("Could not stop Docker container inside LXC (will be stopped with LXC)", {
        applicationId,
        vmid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Try to restart the Docker container inside the LXC without restarting the LXC.
   * Returns true if successful, false if Docker restart failed.
   */
  private async restartDockerContainer(
    applicationId: string,
    node: string,
    vmid: number,
  ): Promise<boolean> {
    const lxcIp = await this.getLXCIP(node, vmid);
    if (!lxcIp) return false;

    try {
      const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);
      const isReady = await testDockerClient(remoteDocker);
      if (isReady) {
        const restarted = await restartContainer(applicationId, remoteDocker);
        if (restarted) {
          logger.info("Docker container restarted inside LXC", { applicationId, vmid });
          return true;
        }
      }
    } catch (err) {
      logger.debug("Could not restart Docker container inside LXC", {
        applicationId,
        vmid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Private helpers — LXC management
  // -------------------------------------------------------------------------

  /**
   * Get the IP address of an LXC container, or null if unavailable.
   */
  private async getLXCIP(node: string, vmid: number): Promise<string | null> {
    try {
      const interfaces = await this.client.getLXCInterfaces(node, vmid);
      return extractIPv4(interfaces);
    } catch {
      return null;
    }
  }

  /**
   * Find the VMID of the LXC container associated with a given application.
   *
   * This uses a hostname-based lookup convention: GuildServer-managed LXC
   * containers have hostnames prefixed with "gs-". The applicationId is
   * matched by searching all LXCs on the configured node.
   *
   * **Note:** This is a temporary approach. In production, the VMID should be
   * stored in the application's `providerMetadata` in the database, which
   * would make this lookup a simple database read.
   */
  private async findVMIDForApp(
    applicationId: string,
  ): Promise<number | null> {
    const node = this.config.node;

    try {
      const lxcs = await this.client.listLXCs(node);

      // Strategy 1: Check if applicationId looks like "pve-{vmid}"
      if (applicationId.startsWith("pve-")) {
        const candidateVmid = parseInt(applicationId.slice(4), 10);
        if (!isNaN(candidateVmid)) {
          const match = lxcs.find((lxc) => lxc.vmid === candidateVmid);
          if (match) return match.vmid;
        }
      }

      // Strategy 2: Match by hostname derived from applicationId
      const expectedHostname = sanitizeHostname(applicationId);
      for (const lxc of lxcs) {
        if (lxc.name === expectedHostname) {
          return lxc.vmid;
        }
      }

      // Strategy 3: Partial match — look for any GuildServer-prefixed
      // hostname that contains the applicationId (or a sanitized form of it)
      const sanitizedId = applicationId
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      for (const lxc of lxcs) {
        const sanitizedName = (lxc.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (
          sanitizedName.startsWith("gs") &&
          sanitizedName.includes(sanitizedId)
        ) {
          return lxc.vmid;
        }
      }

      logger.debug("No LXC found for application", {
        applicationId,
        expectedHostname,
        availableLXCs: lxcs.map((l) => ({ vmid: l.vmid, name: l.name })),
      });

      return null;
    } catch (err) {
      logger.error("Error searching for LXC by application ID", {
        applicationId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Poll the Proxmox API until the LXC container acquires an IP address
   * via DHCP (or static configuration).
   *
   * @param node      Proxmox node name.
   * @param vmid      The LXC's VMID.
   * @param timeoutMs Maximum time to wait before giving up.
   *
   * @returns The first non-loopback IPv4 address found.
   * @throws  If no IP is obtained within the timeout period.
   */
  private async waitForLXCIP(
    node: string,
    vmid: number,
    timeoutMs: number,
  ): Promise<string> {
    const start = Date.now();

    logger.debug("Waiting for LXC IP address", { vmid, timeoutMs });

    while (Date.now() - start < timeoutMs) {
      try {
        const interfaces = await this.client.getLXCInterfaces(node, vmid);
        const ip = extractIPv4(interfaces);

        if (ip) {
          logger.debug("LXC IP address acquired", { vmid, ip });
          return ip;
        }
      } catch {
        // The interfaces endpoint may not be available immediately after
        // the LXC starts. We just continue polling.
      }

      await new Promise((resolve) => setTimeout(resolve, IP_POLL_INTERVAL_MS));
    }

    throw new Error(
      `Timed out waiting for LXC ${vmid} to obtain an IP address after ${timeoutMs}ms`,
    );
  }

  /**
   * Resolve the OS template to use for LXC creation.
   *
   * Attempts to find an Ubuntu template in the configured storage pool.
   * Falls back to the first available template if no Ubuntu variant is found.
   */
  private async resolveTemplate(
    node: string,
    storage: string,
  ): Promise<string> {
    try {
      const templates = await this.client.listTemplates(node, storage);

      if (templates.length === 0) {
        throw new Error(
          `No container templates found in storage "${storage}" on node "${node}". ` +
            "Please upload an Ubuntu template (e.g., ubuntu-22.04-standard) via the Proxmox web UI.",
        );
      }

      // Prefer Ubuntu 22.04 standard template
      const ubuntu22 = templates.find((t) =>
        t.volid.includes("ubuntu-22.04"),
      );
      if (ubuntu22) return ubuntu22.volid;

      // Fallback: any Ubuntu template
      const anyUbuntu = templates.find((t) =>
        t.volid.toLowerCase().includes("ubuntu"),
      );
      if (anyUbuntu) return anyUbuntu.volid;

      // Fallback: any Debian-based template (likely to support Docker)
      const debian = templates.find((t) =>
        t.volid.toLowerCase().includes("debian"),
      );
      if (debian) return debian.volid;

      // Last resort: first available template
      logger.warn(
        "No Ubuntu/Debian template found, using first available template",
        { template: templates[0].volid },
      );
      return templates[0].volid;
    } catch (err) {
      // If listing templates fails, construct a conventional template path
      // as a best-effort fallback. This will fail at LXC creation time if
      // the template doesn't exist, which gives the user a clear error.
      const fallback = `${storage}:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst`;
      logger.warn("Failed to list templates, using fallback", {
        fallback,
        error: err instanceof Error ? err.message : String(err),
      });
      return fallback;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Format an uptime value (in seconds) into a human-readable string.
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}
