import https from "node:https";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxmoxClientConfig {
  host: string;
  port: number;
  tokenId: string; // e.g. "root@pam!guildserver"
  tokenSecret: string; // API token secret
  allowInsecure?: boolean; // skip TLS verification for self-signed certs
}

export interface NodeStatus {
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  status: string;
}

export interface NodeInfo {
  node: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
}

export interface CreateLXCOptions {
  vmid?: number; // auto-assigned if not provided
  hostname: string;
  ostemplate: string; // e.g. "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
  storage: string; // e.g. "local-lvm"
  rootfs?: string; // e.g. "local-lvm:8" (8GB)
  memory: number; // MB
  swap?: number; // MB
  cores: number;
  net0: string; // e.g. "name=eth0,bridge=vmbr0,ip=dhcp"
  password?: string;
  sshKeys?: string;
  start?: boolean; // start after creation
  unprivileged?: boolean;
  features?: string; // e.g. "nesting=1" (required for Docker-in-LXC)
  onboot?: boolean;
}

export interface LXCStatus {
  vmid: number;
  name: string;
  status: string; // "running" | "stopped"
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  pid?: number;
  netin?: number;
  netout?: number;
}

export interface LXCInfo {
  vmid: number;
  name: string;
  status: string;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  cpu: number;
  maxcpu: number;
  uptime: number;
}

export interface NetworkInterface {
  name: string;
  hwaddr: string;
  "ip-addresses"?: Array<{
    "ip-address": string;
    "ip-address-type": string;
    prefix: number;
  }>;
}

export interface StorageInfo {
  storage: string;
  type: string;
  content: string;
  total: number;
  used: number;
  avail: number;
  active: number;
}

export interface TemplateInfo {
  volid: string;
  format: string;
  size: number;
}

export interface TaskResult {
  status: string; // "OK" | "Error"
  exitstatus?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Shape returned by every Proxmox API endpoint. */
interface ProxmoxResponse<T> {
  data: T;
}

/** Error thrown when a Proxmox API call fails. */
export class ProxmoxError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`Proxmox API error ${statusCode} (${statusText}): ${body}`);
    this.name = "ProxmoxError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ProxmoxClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly agent: https.Agent | undefined;

  constructor(private readonly config: ProxmoxClientConfig) {
    this.baseUrl = `https://${config.host}:${config.port}/api2/json`;
    this.authHeader = `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`;

    if (config.allowInsecure) {
      this.agent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  // -----------------------------------------------------------------------
  // Core HTTP
  // -----------------------------------------------------------------------

  /**
   * Send an authenticated request to the Proxmox API.
   *
   * @param method  HTTP verb (GET, POST, PUT, DELETE).
   * @param path    API path **without** the `/api2/json` prefix.
   * @param body    Optional body — serialised as `application/x-www-form-urlencoded`
   *                (which is what the Proxmox API expects for mutations).
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
    };

    let fetchBody: string | undefined;

    if (body !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
      fetchBody = params.toString();
    }

    // Build fetch options. The Node 18 native `fetch` accepts a `dispatcher`
    // option from undici but does NOT accept an `agent` property directly.
    // To honour `allowInsecure` we temporarily disable TLS rejection via the
    // well-known env var for the duration of the request when an insecure
    // agent is configured.  This is the most portable approach across Node 18+
    // without pulling in undici directly.
    const prevTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (this.agent) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: fetchBody,
      });
    } finally {
      // Restore previous value (or delete if it was unset).
      if (this.agent) {
        if (prevTlsReject === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTlsReject;
        }
      }
    }

    const text = await response.text();

    if (!response.ok) {
      throw new ProxmoxError(response.status, response.statusText, text);
    }

    const json = JSON.parse(text) as ProxmoxResponse<T>;
    return json.data;
  }

  // -----------------------------------------------------------------------
  // Nodes
  // -----------------------------------------------------------------------

  /** Return status / resource usage for a single node. */
  async getNodeStatus(node: string): Promise<NodeStatus> {
    // The /nodes/{node}/status endpoint returns a nested structure:
    //   { cpu, cpuinfo: { cpus, ... }, memory: { total, used }, rootfs: { total, used }, uptime, ... }
    // We normalize it to the flat NodeStatus interface used throughout the app.
    const raw = await this.request<any>("GET", `/nodes/${encodeURIComponent(node)}/status`);

    return {
      cpu: raw.cpu ?? 0,
      maxcpu: raw.cpuinfo?.cpus ?? raw.maxcpu ?? 0,
      mem: raw.memory?.used ?? raw.mem ?? 0,
      maxmem: raw.memory?.total ?? raw.maxmem ?? 0,
      disk: raw.rootfs?.used ?? raw.disk ?? 0,
      maxdisk: raw.rootfs?.total ?? raw.maxdisk ?? 0,
      uptime: raw.uptime ?? 0,
      status: raw.status ?? "unknown",
    };
  }

  /** List all nodes in the cluster (or the single standalone node). */
  async listNodes(): Promise<NodeInfo[]> {
    return this.request<NodeInfo[]>("GET", "/nodes");
  }

  // -----------------------------------------------------------------------
  // LXC Container operations
  // -----------------------------------------------------------------------

  /**
   * Create a new LXC container.
   *
   * @returns The UPID of the creation task.  Use {@link waitForTask} to poll
   *          until the container is ready.
   */
  async createLXC(node: string, opts: CreateLXCOptions): Promise<string> {
    const body: Record<string, unknown> = {
      hostname: opts.hostname,
      ostemplate: opts.ostemplate,
      storage: opts.storage,
      memory: opts.memory,
      cores: opts.cores,
      net0: opts.net0,
    };

    if (opts.vmid !== undefined) body.vmid = opts.vmid;
    if (opts.rootfs !== undefined) body.rootfs = opts.rootfs;
    if (opts.swap !== undefined) body.swap = opts.swap;
    if (opts.password !== undefined) body.password = opts.password;
    if (opts.sshKeys !== undefined) body["ssh-public-keys"] = opts.sshKeys;
    if (opts.start !== undefined) body.start = opts.start ? 1 : 0;
    if (opts.unprivileged !== undefined) body.unprivileged = opts.unprivileged ? 1 : 0;
    if (opts.features !== undefined) body.features = opts.features;
    if (opts.onboot !== undefined) body.onboot = opts.onboot ? 1 : 0;

    return this.request<string>(
      "POST",
      `/nodes/${encodeURIComponent(node)}/lxc`,
      body,
    );
  }

  /** Start a stopped LXC container.  Returns UPID. */
  async startLXC(node: string, vmid: number): Promise<string> {
    return this.request<string>(
      "POST",
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/start`,
    );
  }

  /** Stop a running LXC container.  Returns UPID. */
  async stopLXC(node: string, vmid: number): Promise<string> {
    return this.request<string>(
      "POST",
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/stop`,
    );
  }

  /** Destroy (delete) an LXC container.  Returns UPID. */
  async destroyLXC(node: string, vmid: number): Promise<string> {
    return this.request<string>(
      "DELETE",
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}`,
    );
  }

  /** Get current status of an LXC container. */
  async getLXCStatus(node: string, vmid: number): Promise<LXCStatus> {
    // Proxmox API returns `cpus` instead of `maxcpu` — normalize it.
    const raw = await this.request<any>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/current`,
    );
    return {
      ...raw,
      maxcpu: raw.maxcpu ?? raw.cpus ?? 0,
    };
  }

  /** List all LXC containers on a node. */
  async listLXCs(node: string): Promise<LXCInfo[]> {
    // Proxmox API returns `cpus` instead of `maxcpu` — normalize each entry.
    const raw = await this.request<any[]>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/lxc`,
    );
    return raw.map((c) => ({
      ...c,
      maxcpu: c.maxcpu ?? c.cpus ?? 0,
    }));
  }

  /**
   * Obtain the next available VMID from the cluster.
   *
   * Useful when you want to pre-allocate an ID before calling {@link createLXC}.
   */
  async getNextVMID(): Promise<number> {
    const raw = await this.request<number | string>("GET", "/cluster/nextid");
    return typeof raw === "number" ? raw : parseInt(raw, 10);
  }

  // -----------------------------------------------------------------------
  // LXC exec
  // -----------------------------------------------------------------------

  /**
   * Execute a command inside an LXC container.
   *
   * **NOTE:** The Proxmox VE REST API does not expose a direct "exec"
   * endpoint for LXC containers.  Running commands inside a container
   * requires either:
   *
   * 1. SSH-ing into the container (needs the container's IP and credentials).
   * 2. Using the Proxmox node's `pct exec` CLI over an SSH session to the
   *    **host** node.
   *
   * This method is intentionally left as a stub. A full implementation would
   * typically use the `node-ssh` package (or similar) to connect to the
   * Proxmox host node and run `pct exec {vmid} -- {command}`.
   *
   * @throws Always throws — not yet implemented.
   */
  async execInLXC(
    _node: string,
    _vmid: number,
    _command: string,
  ): Promise<string> {
    throw new Error(
      "execInLXC is not yet implemented. " +
        "Proxmox VE does not provide a direct REST exec endpoint for LXC containers. " +
        "Use SSH to the host node and run `pct exec <vmid> -- <command>`, " +
        "or SSH directly into the container. Consider the `node-ssh` package.",
    );
  }

  /**
   * Modify the configuration of an existing LXC container.
   *
   * This can be used to update CPU, memory, network, mount points,
   * or other LXC settings via the Proxmox API.
   *
   * The container should be stopped for most config changes to take effect,
   * although some options (like `description`) can be changed while running.
   */
  async setLXCConfig(
    node: string,
    vmid: number,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.request<null>(
      "PUT",
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`,
      config,
    );
  }

  /**
   * Get the current configuration of an LXC container.
   */
  async getLXCConfig(
    node: string,
    vmid: number,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`,
    );
  }

  // -----------------------------------------------------------------------
  // Network
  // -----------------------------------------------------------------------

  /** Get network interfaces reported by the QEMU guest agent / LXC. */
  async getLXCInterfaces(node: string, vmid: number): Promise<NetworkInterface[]> {
    return this.request<NetworkInterface[]>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/interfaces`,
    );
  }

  // -----------------------------------------------------------------------
  // Storage
  // -----------------------------------------------------------------------

  /** List storage pools available on a node. */
  async listStorage(node: string): Promise<StorageInfo[]> {
    return this.request<StorageInfo[]>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/storage`,
    );
  }

  // -----------------------------------------------------------------------
  // Templates
  // -----------------------------------------------------------------------

  /** List available container templates in a storage pool. */
  async listTemplates(node: string, storage: string): Promise<TemplateInfo[]> {
    return this.request<TemplateInfo[]>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=vztmpl`,
    );
  }

  /**
   * Download (or trigger the download of) a template into a storage pool.
   *
   * @param template  Fully-qualified template name — e.g.
   *   `"ubuntu-22.04-standard_22.04-1_amd64.tar.zst"`.
   * @returns The UPID of the download task.
   */
  async downloadTemplate(
    node: string,
    storage: string,
    template: string,
  ): Promise<string> {
    return this.request<string>(
      "POST",
      `/nodes/${encodeURIComponent(node)}/aplinfo`,
      {
        storage,
        template,
      },
    );
  }

  // -----------------------------------------------------------------------
  // Task tracking
  // -----------------------------------------------------------------------

  /**
   * Poll a Proxmox task until it reaches the `"stopped"` status.
   *
   * @param node       The node the task is running on.
   * @param upid       The UPID returned by the operation that created the task.
   * @param timeoutMs  Maximum time to wait (default: 120 000 ms / 2 minutes).
   *
   * @returns The final {@link TaskResult}.
   * @throws If the timeout is exceeded.
   */
  async waitForTask(
    node: string,
    upid: string,
    timeoutMs: number = 120_000,
  ): Promise<TaskResult> {
    const start = Date.now();
    const encodedUpid = encodeURIComponent(upid);

    while (Date.now() - start < timeoutMs) {
      const result = await this.request<{ status: string; exitstatus?: string }>(
        "GET",
        `/nodes/${encodeURIComponent(node)}/tasks/${encodedUpid}/status`,
      );

      if (result.status === "stopped") {
        return {
          status: result.exitstatus === "OK" ? "OK" : "Error",
          exitstatus: result.exitstatus,
        };
      }

      // Wait 1 second between polls.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(
      `Timed out waiting for task ${upid} after ${timeoutMs}ms`,
    );
  }

  // -----------------------------------------------------------------------
  // Connection test
  // -----------------------------------------------------------------------

  /**
   * Verify that the client can reach the Proxmox API and authenticate.
   *
   * Returns a summary object suitable for displaying in a UI or storing as
   * a provider health-check result.
   */
  async testConnection(): Promise<{
    connected: boolean;
    message: string;
    version?: string;
    nodes?: number;
  }> {
    try {
      // Fetch the PVE version — this validates both connectivity and auth.
      const versionData = await this.request<{
        version: string;
        release: string;
        repoid: string;
      }>("GET", "/version");

      const nodes = await this.listNodes();

      return {
        connected: true,
        message: `Connected to Proxmox VE ${versionData.version} (${versionData.release})`,
        version: versionData.version,
        nodes: nodes.length,
      };
    } catch (err) {
      const message =
        err instanceof ProxmoxError
          ? `API returned ${err.statusCode}: ${err.body}`
          : err instanceof Error
            ? err.message
            : String(err);

      return {
        connected: false,
        message: `Failed to connect: ${message}`,
      };
    }
  }
}
