import { randomBytes } from "node:crypto";
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
  getLocalDockerClient,
  removeClientByHost,
  waitForDockerReady,
  testDockerClient,
  transferDockerImage,
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
import { Client as SSHClient } from "ssh2";
import { logger } from "../utils/logger";
import { db, deployments } from "@guildserver/database";
import { eq, desc, and, isNotNull } from "drizzle-orm";

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

/** Maximum time (ms) to wait for SSH connection to the LXC. */
const SSH_CONNECT_TIMEOUT_MS = 30_000;

/** Maximum time (ms) to allow the Docker bootstrap script to run inside LXC. */
const DOCKER_BOOTSTRAP_TIMEOUT_MS = 180_000;

/** Polling interval (ms) when waiting for SSH readiness. */
const SSH_READY_POLL_MS = 3_000;

/** Maximum time (ms) to wait for SSH to become available after LXC start. */
const SSH_READY_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random password for the LXC root user.
 *
 * This allows admins to SSH into the LXC for manual Docker setup or debugging.
 * The password is stored in the deployment's providerMetadata so it can be
 * retrieved from the DB if needed.
 */
function generateLxcPassword(): string {
  return randomBytes(16).toString("base64url");
}

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
    // Templates (vztmpl) live on directory-type storage (usually "local"),
    // NOT on LVM/ZFS storage which only holds disk images. Auto-detect
    // the correct template storage by querying Proxmox for storages that
    // support "vztmpl" content.
    const { templateStorage, rootfsStorage } = await this.resolveStorages(node, storage);
    const ostemplate = await this.resolveTemplate(node, templateStorage);
    logs.push(`Using OS template: ${ostemplate} (from storage: ${templateStorage})`);
    logs.push(`Using rootfs storage: ${rootfsStorage}`);
    logger.info("Resolved storages", { ostemplate, templateStorage, rootfsStorage });

    // ------------------------------------------------------------------
    // 2. Allocate a VMID
    // ------------------------------------------------------------------
    const vmid = await this.client.getNextVMID();
    logs.push(`Allocated VMID: ${vmid}`);
    logger.info("Allocated VMID", { vmid });

    // ------------------------------------------------------------------
    // 3. Create the LXC container
    // ------------------------------------------------------------------
    const rootfs = `${rootfsStorage}:${DEFAULT_ROOTFS_GB}`;
    const net0 = `name=eth0,bridge=${bridge},ip=dhcp`;

    logs.push(
      `Creating LXC: vmid=${vmid}, memory=${memoryMb}MB, cores=${cores}, rootfs=${rootfs}`,
    );

    // Generate a root password for the LXC so admins can SSH in
    // to set up Docker or debug. Stored in providerMetadata.
    const lxcPassword = generateLxcPassword();
    logs.push(`LXC root password generated (stored in deployment metadata)`);

    const createUpid = await this.client.createLXC(node, {
      vmid,
      hostname,
      ostemplate,
      storage: rootfsStorage,
      rootfs,
      memory: memoryMb,
      swap: Math.round(memoryMb / 2),
      cores,
      net0,
      password: lxcPassword,
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
    // 6. Bootstrap Docker inside the LXC via SSH
    // ------------------------------------------------------------------
    const containerPort = config.containerPort || 3000;
    let dockerContainerId: string | null = null;
    let dockerContainerName: string | null = null;
    let dockerHostPort = 0;

    if (lxcIp) {
      try {
        // 6a. SSH into the LXC and install Docker + configure TCP 2375
        logs.push(`Bootstrapping Docker inside LXC via SSH (root@${lxcIp})...`);
        logger.info("Starting Docker bootstrap via SSH", { vmid, lxcIp });

        const bootstrapLogs = await this.bootstrapDockerViaSSH(lxcIp, lxcPassword);
        logs.push(...bootstrapLogs);

        // 6b. Wait for Docker daemon to become ready on TCP 2375
        const remoteDocker = getDockerClient(lxcIp, DOCKER_TCP_PORT);
        logs.push(`Waiting for Docker daemon at ${lxcIp}:${DOCKER_TCP_PORT}...`);
        await waitForDockerReady(remoteDocker, DOCKER_READY_TIMEOUT_MS);
        logs.push("Docker daemon is ready inside LXC");

        // 6c. Transfer the image if it's locally built (gs-* prefix)
        const isLocalImage = config.dockerImage.startsWith("gs-");
        const imageTag = `${config.dockerImage}:${config.dockerTag}`;

        if (isLocalImage) {
          logs.push(`Transferring locally-built image ${imageTag} to LXC...`);
          logger.info("Transferring Docker image to LXC", { vmid, imageTag, lxcIp });

          const localDocker = getLocalDockerClient();
          await transferDockerImage(imageTag, localDocker, remoteDocker);
          logs.push(`Image ${imageTag} transferred successfully`);
        } else {
          // Pull from registry on the remote Docker daemon
          const pullLogs = await pullImage(
            config.dockerImage,
            config.dockerTag,
            config.userId,
            config.deploymentId,
            remoteDocker,
          );
          logs.push(...pullLogs);
        }

        // 6d. Deploy the application container inside the LXC
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
        logs.push(`Warning: Docker deployment inside LXC failed: ${msg}`);
        logs.push("The LXC is running but Docker setup failed.");
        logs.push("To set up Docker manually, SSH into the LXC and run:");
        logs.push(`  ssh root@${lxcIp}  (password is stored in deployment metadata)`);
        logs.push("  apt-get update && apt-get install -y docker.io");
        logs.push('  mkdir -p /etc/systemd/system/docker.service.d');
        logs.push('  echo -e "[Service]\\nExecStart=\\nExecStart=/usr/bin/dockerd -H unix:///var/run/docker.sock -H tcp://0.0.0.0:2375" > /etc/systemd/system/docker.service.d/override.conf');
        logs.push("  systemctl daemon-reload && systemctl restart docker");
        logger.warn("Docker deployment inside LXC failed", {
          vmid,
          lxcIp,
          error: msg,
        });
      }
    } else {
      logs.push("Note: Could not deploy Docker container — no LXC IP address available.");
      logs.push("The LXC is running. Check the Proxmox web UI for its IP.");
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
        lxcPassword,
        storage,
        bridge,
        dockerContainerId: dockerContainerId || null,
        dockerContainerName: dockerContainerName || null,
        dockerHostPort,
        dockerReady: !!dockerContainerId,
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
  // Private helpers — SSH Docker bootstrap
  // -------------------------------------------------------------------------

  /**
   * Wait for the SSH server inside the LXC to become reachable.
   * After an LXC starts, sshd may take a few seconds to initialise.
   */
  private async waitForSSH(
    host: string,
    password: string,
    timeoutMs: number = SSH_READY_TIMEOUT_MS,
  ): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        await this.sshExec(host, password, "echo ok", 10_000);
        return; // SSH is ready
      } catch {
        // Not ready yet — wait and retry
      }
      await new Promise((resolve) => setTimeout(resolve, SSH_READY_POLL_MS));
    }

    throw new Error(`SSH not reachable at ${host} within ${timeoutMs}ms`);
  }

  /**
   * Execute a command over SSH and return the combined stdout/stderr output.
   */
  private sshExec(
    host: string,
    password: string,
    command: string,
    timeoutMs: number = DOCKER_BOOTSTRAP_TIMEOUT_MS,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let output = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        conn.end();
        reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${command.slice(0, 80)}`));
      }, timeoutMs);

      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timer);
              conn.end();
              return reject(err);
            }

            stream
              .on("data", (data: Buffer) => {
                output += data.toString();
              })
              .stderr.on("data", (data: Buffer) => {
                output += data.toString();
              });

            stream.on("close", (code: number) => {
              clearTimeout(timer);
              conn.end();
              if (timedOut) return;
              if (code !== 0) {
                reject(new Error(`SSH command exited with code ${code}: ${output.slice(-500)}`));
              } else {
                resolve(output);
              }
            });
          });
        })
        .on("error", (err) => {
          clearTimeout(timer);
          if (!timedOut) reject(err);
        })
        .connect({
          host,
          port: 22,
          username: "root",
          password,
          readyTimeout: SSH_CONNECT_TIMEOUT_MS,
          // Accept any host key — LXC containers are ephemeral
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          hostVerifier: (_key: any) => true,
        } as any);
    });
  }

  /**
   * Bootstrap Docker inside a fresh LXC container via SSH.
   *
   * Steps:
   *  1. Configure DNS (in case DHCP didn't provide resolvers)
   *  2. Install docker.io from Ubuntu repos
   *  3. Configure Docker daemon to listen on TCP 2375
   *  4. Override systemd unit to avoid -H fd:// conflict
   *  5. Restart Docker
   *
   * Returns an array of log lines describing what was done.
   */
  private async bootstrapDockerViaSSH(
    host: string,
    password: string,
  ): Promise<string[]> {
    const logs: string[] = [];

    // Wait for SSH to become available
    logs.push("Waiting for SSH to become available...");
    await this.waitForSSH(host, password);
    logs.push("SSH connection established");

    // Run the bootstrap script as a single bash -c invocation
    const bootstrapScript = `bash -c '
set -e

# Ensure DNS resolution works (DHCP may not provide nameservers)
grep -q "nameserver" /etc/resolv.conf || echo "nameserver 8.8.8.8" >> /etc/resolv.conf
echo "nameserver 8.8.8.8" >> /etc/resolv.conf

# Update package lists and install Docker
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io

# Create systemd override to remove the default -H fd:// flag
# (it conflicts with the "hosts" key in daemon.json)
mkdir -p /etc/systemd/system/docker.service.d
printf "[Service]\\nExecStart=\\nExecStart=/usr/bin/dockerd -H unix:///var/run/docker.sock -H tcp://0.0.0.0:2375\\n" > /etc/systemd/system/docker.service.d/override.conf

# Reload systemd and start Docker
systemctl daemon-reload
systemctl enable docker
systemctl restart docker

# Verify Docker is running
sleep 2
docker info >/dev/null 2>&1 && echo "DOCKER_BOOTSTRAP_OK" || echo "DOCKER_BOOTSTRAP_FAIL"
'`;

    logs.push("Installing Docker and configuring TCP listener...");
    logger.info("Running Docker bootstrap script via SSH", { host });

    try {
      const output = await this.sshExec(host, password, bootstrapScript);

      if (output.includes("DOCKER_BOOTSTRAP_OK")) {
        logs.push("Docker installed and configured successfully");
        logger.info("Docker bootstrap completed", { host });
      } else {
        // Docker installed but verification failed — may still work after a moment
        logs.push("Docker installed but initial verification uncertain — will retry via TCP");
        logger.warn("Docker bootstrap verification uncertain", { host, output: output.slice(-200) });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`Docker bootstrap error: ${msg}`);
      logger.error("Docker bootstrap failed", { host, error: msg });
      throw new Error(`Failed to bootstrap Docker in LXC at ${host}: ${msg}`);
    }

    return logs;
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
   * Uses a two-tier lookup strategy:
   * 1. **Database lookup** (preferred) — checks the latest deployment's
   *    `lxcVmId` column for this application, which is stored during deploy.
   * 2. **Hostname-based fallback** — scans all LXCs on the Proxmox node and
   *    matches by the "gs-{appName}" hostname convention. This handles legacy
   *    deployments or cases where the DB record was lost.
   */
  private async findVMIDForApp(
    applicationId: string,
  ): Promise<number | null> {
    const node = this.config.node;

    try {
      // Strategy 1: Database lookup — fastest and most reliable
      const latestDeployment = await db.query.deployments.findFirst({
        where: and(
          eq(deployments.applicationId, applicationId),
          isNotNull(deployments.lxcVmId),
        ),
        orderBy: [desc(deployments.createdAt)],
        columns: { lxcVmId: true },
      });

      if (latestDeployment?.lxcVmId) {
        // Verify the VMID still exists on the Proxmox node
        try {
          const status = await this.client.getLXCStatus(
            node,
            latestDeployment.lxcVmId,
          );
          if (status) {
            logger.debug("Found VMID via database lookup", {
              applicationId,
              vmid: latestDeployment.lxcVmId,
            });
            return latestDeployment.lxcVmId;
          }
        } catch {
          // VMID from DB doesn't exist on node anymore — fall through to scan
          logger.debug("DB VMID no longer exists on Proxmox, falling back to scan", {
            applicationId,
            staleVmid: latestDeployment.lxcVmId,
          });
        }
      }

      // Strategy 2: Hostname-based scan (fallback for legacy deployments)
      const lxcs = await this.client.listLXCs(node);

      // Check if applicationId looks like "pve-{vmid}"
      if (applicationId.startsWith("pve-")) {
        const candidateVmid = parseInt(applicationId.slice(4), 10);
        if (!isNaN(candidateVmid)) {
          const match = lxcs.find((lxc) => lxc.vmid === candidateVmid);
          if (match) return match.vmid;
        }
      }

      // Match by hostname derived from applicationId
      const expectedHostname = sanitizeHostname(applicationId);
      for (const lxc of lxcs) {
        if (lxc.name === expectedHostname) {
          return lxc.vmid;
        }
      }

      // Partial match — look for any GuildServer-prefixed hostname
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
   * Determine the correct storage pools for templates and rootfs.
   *
   * Proxmox storage pools serve different content types:
   *   - "vztmpl" → OS templates (directory storage, usually "local")
   *   - "rootdir" → container rootfs (block storage, usually "local-lvm")
   *   - "images" → VM disk images (also block storage)
   *
   * This method queries all storages on the node and picks the right one
   * for each purpose, regardless of what the user configured.
   */
  private async resolveStorages(
    node: string,
    configuredStorage: string,
  ): Promise<{ templateStorage: string; rootfsStorage: string }> {
    try {
      const storages = await this.client.listStorage(node);

      logger.info("Available Proxmox storages", {
        storages: storages.map((s) => ({
          name: s.storage,
          type: s.type,
          content: s.content,
        })),
      });

      // --- Template storage (needs "vztmpl" content support) ---
      let templateStorage = "local";
      const configuredEntry = storages.find(
        (s) => s.storage === configuredStorage,
      );
      if (configuredEntry && configuredEntry.content.includes("vztmpl")) {
        templateStorage = configuredStorage;
      } else {
        const vztmplStore = storages.find((s) =>
          s.content.includes("vztmpl"),
        );
        if (vztmplStore) {
          templateStorage = vztmplStore.storage;
        }
      }

      // --- Rootfs storage (needs "rootdir" or "images" content support) ---
      let rootfsStorage = "local-lvm";
      if (
        configuredEntry &&
        (configuredEntry.content.includes("rootdir") ||
          configuredEntry.content.includes("images"))
      ) {
        rootfsStorage = configuredStorage;
      } else {
        const rootdirStore = storages.find(
          (s) =>
            s.content.includes("rootdir") || s.content.includes("images"),
        );
        if (rootdirStore) {
          rootfsStorage = rootdirStore.storage;
        }
      }

      logger.info("Resolved storages", {
        templateStorage,
        rootfsStorage,
        configuredStorage,
      });

      return { templateStorage, rootfsStorage };
    } catch (err) {
      logger.warn("Failed to query storages, using defaults", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { templateStorage: "local", rootfsStorage: "local-lvm" };
    }
  }

  /**
   * Resolve the OS template to use for LXC creation.
   *
   * Attempts to find an Ubuntu template in the given storage pool.
   * Falls back to the first available template if no Ubuntu variant is found.
   */
  private async resolveTemplate(
    node: string,
    templateStorage: string,
  ): Promise<string> {
    try {
      const templates = await this.client.listTemplates(node, templateStorage);

      if (templates.length === 0) {
        throw new Error(
          `No container templates found in storage "${templateStorage}" on node "${node}". ` +
            "Please upload an Ubuntu template (e.g., ubuntu-22.04-standard) via the Proxmox web UI: " +
            `Datacenter → ${node} → ${templateStorage} → CT Templates → Templates button.`,
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
      // If listing templates fails, try "local" as a last resort fallback
      const fallback = `local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst`;
      logger.warn("Failed to list templates, using fallback path", {
        fallback,
        templateStorage,
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
