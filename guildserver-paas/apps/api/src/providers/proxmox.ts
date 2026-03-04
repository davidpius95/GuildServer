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
 *   4. Record the VMID and IP in provider metadata for future operations.
 *   5. (Follow-up) Execute `docker pull` + `docker run` inside the LXC via
 *      SSH or `pct exec` once the exec transport is implemented.
 */
export class ProxmoxProvider implements ComputeProvider {
  readonly type: ProviderType = "proxmox";
  private client: ProxmoxClient;
  private config: ProxmoxConfig;

  constructor(config: ProxmoxConfig) {
    this.config = config;
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
    // 6. (Future) Run docker pull + docker run inside the LXC
    // ------------------------------------------------------------------
    // The Proxmox REST API does not expose a direct exec endpoint for LXC.
    // Once SSH-based exec is implemented, this is where we would run:
    //   docker pull ${config.dockerImage}:${config.dockerTag}
    //   docker run -d --name app \
    //     -p ${config.containerPort || 3000}:${config.containerPort || 3000} \
    //     ${envFlags} \
    //     ${config.dockerImage}:${config.dockerTag}
    //
    // For now, we log a note and store the intended Docker config in metadata.
    logs.push(
      "Note: Docker container deployment inside LXC requires SSH exec (not yet implemented). " +
        "The LXC is running and ready for manual Docker setup or SSH-based automation.",
    );

    const containerPort = config.containerPort || 3000;
    const containerName = `pve-${vmid}`;

    logger.info("Proxmox deploy completed (LXC ready, Docker step pending)", {
      applicationId: config.applicationId,
      vmid,
      hostname,
      lxcIp,
    });

    return {
      containerId: containerName,
      containerName,
      hostPort: 0, // Proxmox networking is different from Docker port mapping
      logs,
      providerMetadata: {
        provider: "proxmox",
        vmid,
        node,
        hostname,
        lxcIp: lxcIp || null,
        storage,
        bridge,
        // Store the intended Docker container config for when exec is available
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
        // Stop first
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

  async getLogs(applicationId: string, _lines?: number): Promise<string[]> {
    const vmid = await this.findVMIDForApp(applicationId);

    if (!vmid) {
      return [
        `No Proxmox LXC container found for application ${applicationId}.`,
      ];
    }

    // The Proxmox REST API does not provide a direct way to stream LXC
    // console logs. Retrieving application logs (from the Docker container
    // running inside the LXC) requires SSH exec, which is not yet implemented.
    return [
      `Logs for LXC VMID ${vmid} on node ${this.config.node}:`,
      "",
      "Direct log retrieval is not yet available for Proxmox-managed deployments.",
      "To view logs, use one of the following methods:",
      `  1. Proxmox Web UI: https://${this.config.host}:${this.config.port || 8006}`,
      `  2. SSH into the LXC and run: docker logs app`,
      `  3. From the Proxmox host: pct exec ${vmid} -- docker logs app`,
      "",
      "Automated log retrieval via SSH will be available in a future update.",
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

      // Attempt to get the LXC's IP address for port info
      let lxcIp: string | null = null;
      if (status.status === "running") {
        try {
          const interfaces = await this.client.getLXCInterfaces(node, vmid);
          lxcIp = extractIPv4(interfaces);
        } catch {
          // Interfaces may not be available; that's okay.
        }
      }

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
      const isRunning = status.status === "running";

      return {
        healthy: isRunning,
        status: status.status,
        message: isRunning
          ? `LXC ${vmid} (${status.name}) is running (uptime: ${formatUptime(status.uptime)})`
          : `LXC ${vmid} (${status.name}) is ${status.status}`,
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
  // Private helpers
  // -------------------------------------------------------------------------

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
