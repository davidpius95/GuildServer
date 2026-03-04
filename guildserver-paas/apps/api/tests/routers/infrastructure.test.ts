/**
 * Infrastructure Router Tests
 *
 * Tests for the Proxmox infrastructure management tRPC router.
 * All procedures are admin-only and operate against a Proxmox VE API
 * (mocked in tests).
 */

// ---------------------------------------------------------------------------
// Mocks — must be at top-level before any imports
// ---------------------------------------------------------------------------

const mockGetNodeStatus = jest.fn();
const mockListLXCs = jest.fn();
const mockListStorage = jest.fn();
const mockListTemplates = jest.fn();
const mockTestConnectionClient = jest.fn();

jest.mock("../../src/services/proxmox-client", () => {
  return {
    ProxmoxClient: jest.fn().mockImplementation(() => ({
      getNodeStatus: mockGetNodeStatus,
      listLXCs: mockListLXCs,
      listStorage: mockListStorage,
      listTemplates: mockListTemplates,
      testConnection: mockTestConnectionClient,
    })),
    ProxmoxError: class ProxmoxError extends Error {
      statusCode: number;
      statusText: string;
      body: string;
      constructor(statusCode: number, statusText: string, body: string) {
        super(`Proxmox API error ${statusCode} (${statusText}): ${body}`);
        this.name = "ProxmoxError";
        this.statusCode = statusCode;
        this.statusText = statusText;
        this.body = body;
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { db } from "../setup";
import { computeProviders } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { infrastructureRouter } from "../../src/routers/infrastructure";

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function createAdminContext() {
  return {
    db,
    req: {} as any,
    res: {} as any,
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "admin@test.com",
      name: "Admin",
      role: "admin",
    },
    isAuthenticated: true,
    isAdmin: true,
  };
}

function createUserContext() {
  return {
    db,
    req: {} as any,
    res: {} as any,
    user: {
      id: "00000000-0000-0000-0000-000000000002",
      email: "user@test.com",
      name: "Regular User",
      role: "user",
    },
    isAuthenticated: true,
    isAdmin: false,
  };
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const proxmoxConfig = {
  host: "192.168.1.100",
  port: 8006,
  tokenId: "root@pam!guildserver",
  tokenSecret: "super-secret-token",
  node: "pve",
  storage: "local-lvm",
  bridge: "vmbr0",
};

async function createProxmoxProvider(overrides: Record<string, unknown> = {}) {
  const [provider] = await db
    .insert(computeProviders)
    .values({
      name: "Test Proxmox",
      type: "proxmox",
      config: proxmoxConfig,
      status: "connected",
      ...overrides,
    })
    .returning();
  return provider;
}

async function createDockerLocalProvider() {
  const [provider] = await db
    .insert(computeProviders)
    .values({
      name: "Local Docker",
      type: "docker-local",
      config: {},
      status: "connected",
    })
    .returning();
  return provider;
}

// ---------------------------------------------------------------------------
// Mock response data
// ---------------------------------------------------------------------------

const mockNodeStatus = {
  cpu: 0.23,
  maxcpu: 8,
  mem: 4294967296, // 4 GB
  maxmem: 17179869184, // 16 GB
  disk: 53687091200, // 50 GB
  maxdisk: 214748364800, // 200 GB
  uptime: 86400, // 1 day
  status: "online",
};

const mockLxcList = [
  {
    vmid: 100,
    name: "gs-my-app",
    status: "running",
    cpu: 0.05,
    maxcpu: 2,
    mem: 268435456, // 256 MB
    maxmem: 1073741824, // 1 GB
    disk: 1073741824, // 1 GB
    maxdisk: 8589934592, // 8 GB
    uptime: 3600,
  },
  {
    vmid: 101,
    name: "other-container",
    status: "stopped",
    cpu: 0,
    maxcpu: 1,
    mem: 0,
    maxmem: 536870912, // 512 MB
    disk: 524288000, // 500 MB
    maxdisk: 4294967296, // 4 GB
    uptime: 0,
  },
];

const mockStorageList = [
  {
    storage: "local-lvm",
    type: "lvmthin",
    content: "rootdir,images",
    total: 214748364800,
    used: 53687091200,
    avail: 161061273600,
    active: 1,
  },
  {
    storage: "local",
    type: "dir",
    content: "iso,vztmpl,backup",
    total: 107374182400,
    used: 10737418240,
    avail: 96636764160,
    active: 1,
  },
];

const mockTemplateList = [
  {
    volid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
    format: "tar.zst",
    size: 134217728,
  },
  {
    volid: "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst",
    format: "tar.zst",
    size: 117440512,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Infrastructure Router", () => {
  const caller = infrastructureRouter.createCaller(createAdminContext());
  const userCaller = infrastructureRouter.createCaller(createUserContext());

  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mock responses
    mockGetNodeStatus.mockResolvedValue(mockNodeStatus);
    mockListLXCs.mockResolvedValue(mockLxcList);
    mockListStorage.mockResolvedValue(mockStorageList);
    mockListTemplates.mockResolvedValue(mockTemplateList);
    mockTestConnectionClient.mockResolvedValue({
      connected: true,
      message: "Connected to Proxmox VE 8.1 (8.1-2)",
    });
  });

  // =========================================================================
  // getNodeResources
  // =========================================================================

  describe("getNodeResources", () => {
    it("should return live resource usage for a Proxmox provider", async () => {
      const provider = await createProxmoxProvider();

      const result = await caller.getNodeResources({ id: provider.id });

      expect(result.providerId).toBe(provider.id);
      expect(result.providerName).toBe("Test Proxmox");
      expect(result.node).toBe("pve");
      expect(result.cpu.usagePercent).toBe(23);
      expect(result.cpu.cores).toBe(8);
      expect(result.memory.usagePercent).toBe(25); // 4GB / 16GB
      expect(result.disk.usagePercent).toBe(25); // 50GB / 200GB
      expect(result.uptime).toBe(86400);
      expect(result.status).toBe("online");
      expect(mockGetNodeStatus).toHaveBeenCalledWith("pve");
    });

    it("should throw NOT_FOUND for non-existent provider", async () => {
      await expect(
        caller.getNodeResources({ id: "00000000-0000-0000-0000-000000000099" }),
      ).rejects.toThrow("Provider not found");
    });

    it("should throw BAD_REQUEST for non-Proxmox provider", async () => {
      const provider = await createDockerLocalProvider();

      await expect(caller.getNodeResources({ id: provider.id })).rejects.toThrow(
        "not \"proxmox\"",
      );
    });

    it("should throw INTERNAL_SERVER_ERROR when Proxmox API fails", async () => {
      const provider = await createProxmoxProvider();
      mockGetNodeStatus.mockRejectedValue(new Error("Connection refused"));

      await expect(caller.getNodeResources({ id: provider.id })).rejects.toThrow(
        "Failed to fetch node resources",
      );
    });

    it("should reject non-admin users", async () => {
      const provider = await createProxmoxProvider();

      await expect(userCaller.getNodeResources({ id: provider.id })).rejects.toThrow(
        /UNAUTHORIZED|FORBIDDEN/,
      );
    });
  });

  // =========================================================================
  // listLxcContainers
  // =========================================================================

  describe("listLxcContainers", () => {
    it("should return LXC container list with resource info", async () => {
      const provider = await createProxmoxProvider();

      const result = await caller.listLxcContainers({ id: provider.id });

      expect(result.providerId).toBe(provider.id);
      expect(result.node).toBe("pve");
      expect(result.total).toBe(2);
      expect(result.guildServerManaged).toBe(1); // gs-my-app
      expect(result.containers).toHaveLength(2);

      // Check first container (gs-my-app)
      const gsContainer = result.containers.find((c) => c.vmid === 100)!;
      expect(gsContainer.name).toBe("gs-my-app");
      expect(gsContainer.status).toBe("running");
      expect(gsContainer.isGuildServer).toBe(true);
      expect(gsContainer.memory.usagePercent).toBe(25); // 256MB / 1GB

      // Check second container (not GuildServer-managed)
      const otherContainer = result.containers.find((c) => c.vmid === 101)!;
      expect(otherContainer.name).toBe("other-container");
      expect(otherContainer.isGuildServer).toBe(false);
    });

    it("should handle empty container list", async () => {
      const provider = await createProxmoxProvider();
      mockListLXCs.mockResolvedValue([]);

      const result = await caller.listLxcContainers({ id: provider.id });

      expect(result.containers).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.guildServerManaged).toBe(0);
    });

    it("should throw NOT_FOUND for non-existent provider", async () => {
      await expect(
        caller.listLxcContainers({ id: "00000000-0000-0000-0000-000000000099" }),
      ).rejects.toThrow("Provider not found");
    });

    it("should throw BAD_REQUEST for non-Proxmox provider", async () => {
      const provider = await createDockerLocalProvider();

      await expect(caller.listLxcContainers({ id: provider.id })).rejects.toThrow(
        "not \"proxmox\"",
      );
    });

    it("should reject non-admin users", async () => {
      const provider = await createProxmoxProvider();

      await expect(userCaller.listLxcContainers({ id: provider.id })).rejects.toThrow(
        /UNAUTHORIZED|FORBIDDEN/,
      );
    });
  });

  // =========================================================================
  // listStorages
  // =========================================================================

  describe("listStorages", () => {
    it("should return storage pools with formatted info", async () => {
      const provider = await createProxmoxProvider();

      const result = await caller.listStorages({ id: provider.id });

      expect(result.providerId).toBe(provider.id);
      expect(result.node).toBe("pve");
      expect(result.storages).toHaveLength(2);

      // Check LVM thin pool (supports rootfs)
      const lvm = result.storages.find((s) => s.storage === "local-lvm")!;
      expect(lvm.type).toBe("lvmthin");
      expect(lvm.supportsRootfs).toBe(true);
      expect(lvm.usagePercent).toBe(25);
      expect(lvm.active).toBe(true);

      // Check local dir storage (does not support rootfs)
      const local = result.storages.find((s) => s.storage === "local")!;
      expect(local.type).toBe("dir");
      expect(local.supportsRootfs).toBe(false);
      expect(local.content).toContain("vztmpl");
    });

    it("should reject non-admin users", async () => {
      const provider = await createProxmoxProvider();

      await expect(userCaller.listStorages({ id: provider.id })).rejects.toThrow(
        /UNAUTHORIZED|FORBIDDEN/,
      );
    });

    it("should throw NOT_FOUND for non-existent provider", async () => {
      await expect(
        caller.listStorages({ id: "00000000-0000-0000-0000-000000000099" }),
      ).rejects.toThrow("Provider not found");
    });
  });

  // =========================================================================
  // listTemplates
  // =========================================================================

  describe("listTemplates", () => {
    it("should return templates from the default storage", async () => {
      const provider = await createProxmoxProvider();

      const result = await caller.listTemplates({ id: provider.id });

      expect(result.providerId).toBe(provider.id);
      expect(result.storage).toBe("local-lvm"); // default from config
      expect(result.templates).toHaveLength(2);

      const ubuntu = result.templates.find((t) =>
        t.name.includes("ubuntu"),
      )!;
      expect(ubuntu.name).toBe("ubuntu-22.04-standard_22.04-1_amd64.tar.zst");
      expect(ubuntu.format).toBe("tar.zst");

      // Verify friendly name extraction
      const debian = result.templates.find((t) =>
        t.name.includes("debian"),
      )!;
      expect(debian.name).toBe("debian-12-standard_12.2-1_amd64.tar.zst");
    });

    it("should use a custom storage when specified", async () => {
      const provider = await createProxmoxProvider();

      await caller.listTemplates({ id: provider.id, storage: "custom-store" });

      expect(mockListTemplates).toHaveBeenCalledWith("pve", "custom-store");
    });

    it("should handle empty template list", async () => {
      const provider = await createProxmoxProvider();
      mockListTemplates.mockResolvedValue([]);

      const result = await caller.listTemplates({ id: provider.id });

      expect(result.templates).toHaveLength(0);
    });

    it("should reject non-admin users", async () => {
      const provider = await createProxmoxProvider();

      await expect(userCaller.listTemplates({ id: provider.id })).rejects.toThrow(
        /UNAUTHORIZED|FORBIDDEN/,
      );
    });
  });

  // =========================================================================
  // setMaintenance
  // =========================================================================

  describe("setMaintenance", () => {
    it("should set a provider into maintenance mode (disabled)", async () => {
      const provider = await createProxmoxProvider({ status: "connected" });

      const result = await caller.setMaintenance({
        id: provider.id,
        maintenance: true,
      });

      expect(result.status).toBe("disabled");
      expect(result.config).toEqual({}); // credentials stripped

      // Verify DB was updated
      const dbProvider = await db.query.computeProviders.findFirst({
        where: eq(computeProviders.id, provider.id),
      });
      expect(dbProvider!.status).toBe("disabled");
    });

    it("should take a provider out of maintenance mode", async () => {
      const provider = await createProxmoxProvider({ status: "disabled" });

      const result = await caller.setMaintenance({
        id: provider.id,
        maintenance: false,
      });

      expect(result.status).toBe("connected");
      // Should have tested connection on the way out
      expect(mockTestConnectionClient).toHaveBeenCalled();
    });

    it("should fail to leave maintenance if connection check fails", async () => {
      const provider = await createProxmoxProvider({ status: "disabled" });
      mockTestConnectionClient.mockResolvedValue({
        connected: false,
        message: "Connection refused",
      });

      await expect(
        caller.setMaintenance({ id: provider.id, maintenance: false }),
      ).rejects.toThrow("connection check failed");
    });

    it("should throw NOT_FOUND for non-existent provider", async () => {
      await expect(
        caller.setMaintenance({
          id: "00000000-0000-0000-0000-000000000099",
          maintenance: true,
        }),
      ).rejects.toThrow("Provider not found");
    });

    it("should work for non-Proxmox providers (skip connection check)", async () => {
      const provider = await createDockerLocalProvider();

      const result = await caller.setMaintenance({
        id: provider.id,
        maintenance: true,
      });

      expect(result.status).toBe("disabled");
      // No Proxmox connection check for non-Proxmox providers
      expect(mockTestConnectionClient).not.toHaveBeenCalled();
    });

    it("should reject non-admin users", async () => {
      const provider = await createProxmoxProvider();

      await expect(
        userCaller.setMaintenance({ id: provider.id, maintenance: true }),
      ).rejects.toThrow(/UNAUTHORIZED|FORBIDDEN/);
    });
  });

  // =========================================================================
  // overview
  // =========================================================================

  describe("overview", () => {
    it("should return overview of all Proxmox providers with live data", async () => {
      const provider = await createProxmoxProvider();

      const result = await caller.overview();

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(provider.id);
      expect(result[0]!.name).toBe("Test Proxmox");
      expect(result[0]!.live.reachable).toBe(true);
      expect(result[0]!.live.cpu.usagePercent).toBe(23);
    });

    it("should exclude non-Proxmox providers", async () => {
      await createProxmoxProvider();
      await createDockerLocalProvider();

      const result = await caller.overview();

      // Only the Proxmox provider
      expect(result).toHaveLength(1);
    });

    it("should handle unreachable providers gracefully", async () => {
      await createProxmoxProvider();
      mockGetNodeStatus.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await caller.overview();

      expect(result).toHaveLength(1);
      expect(result[0]!.live.reachable).toBe(false);
    });

    it("should handle multiple providers", async () => {
      await createProxmoxProvider({ name: "Node 1" });
      await createProxmoxProvider({ name: "Node 2" });

      const result = await caller.overview();

      expect(result).toHaveLength(2);
      const names = result.map((r: any) => r.name);
      expect(names).toContain("Node 1");
      expect(names).toContain("Node 2");
    });

    it("should return empty array when no Proxmox providers exist", async () => {
      await createDockerLocalProvider();

      const result = await caller.overview();

      expect(result).toHaveLength(0);
    });

    it("should reject non-admin users", async () => {
      await expect(userCaller.overview()).rejects.toThrow(/UNAUTHORIZED|FORBIDDEN/);
    });
  });

  // =========================================================================
  // Credential safety
  // =========================================================================

  describe("credential safety", () => {
    it("should never expose provider credentials in setMaintenance response", async () => {
      const provider = await createProxmoxProvider();

      const result = await caller.setMaintenance({
        id: provider.id,
        maintenance: true,
      });

      // Config should be empty object — no credentials
      expect(result.config).toEqual({});
      expect(JSON.stringify(result)).not.toContain("super-secret-token");
      expect(JSON.stringify(result)).not.toContain("tokenSecret");
    });

    it("should never expose credentials in overview response", async () => {
      await createProxmoxProvider();

      const result = await caller.overview();

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("super-secret-token");
      expect(serialized).not.toContain("tokenSecret");
      expect(serialized).not.toContain("tokenId");
    });
  });
});
