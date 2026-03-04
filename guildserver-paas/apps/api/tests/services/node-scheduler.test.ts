/**
 * Node Scheduler Tests
 *
 * Tests for the node scheduling logic that selects the best Proxmox
 * node for deployment using a weighted scoring algorithm.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetNodeStatus = jest.fn();
const mockListLXCs = jest.fn();

jest.mock("../../src/services/proxmox-client", () => ({
  ProxmoxClient: jest.fn().mockImplementation(() => ({
    getNodeStatus: mockGetNodeStatus,
    listLXCs: mockListLXCs,
  })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { db, testUtils } from "../setup";
import { computeProviders } from "@guildserver/database";
import { selectNode, getNodeLoad } from "../../src/services/node-scheduler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseConfig = {
  host: "192.168.1.100",
  port: 8006,
  tokenId: "root@pam!guildserver",
  tokenSecret: "secret",
  node: "pve",
  storage: "local-lvm",
  bridge: "vmbr0",
};

async function createProvider(overrides: Record<string, unknown> = {}) {
  const [provider] = await db
    .insert(computeProviders)
    .values({
      name: "Test Proxmox",
      type: "proxmox",
      config: baseConfig,
      status: "connected",
      ...overrides,
    })
    .returning();
  return provider;
}

function mockNodeStatus(overrides: Record<string, unknown> = {}) {
  return {
    cpu: 0.2,
    maxcpu: 8,
    mem: 4 * 1024 ** 3, // 4 GB
    maxmem: 16 * 1024 ** 3, // 16 GB
    disk: 50 * 1024 ** 3, // 50 GB
    maxdisk: 200 * 1024 ** 3, // 200 GB
    uptime: 86400,
    status: "online",
    ...overrides,
  };
}

function mockLxcList(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    vmid: 100 + i,
    name: `container-${i}`,
    status: "running",
    cpu: 0.01,
    maxcpu: 1,
    mem: 256 * 1024 ** 2,
    maxmem: 1024 * 1024 ** 2,
    disk: 1 * 1024 ** 3,
    maxdisk: 8 * 1024 ** 3,
    uptime: 3600,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Node Scheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // selectNode
  // =========================================================================

  describe("selectNode", () => {
    it("should return fallback to local when no Proxmox providers exist", async () => {
      const result = await selectNode();

      expect(result.provider).toBeNull();
      expect(result.fallbackToLocal).toBe(true);
      expect(result.reason).toContain("No online Proxmox providers");
    });

    it("should return fallback when only non-Proxmox providers exist", async () => {
      await db.insert(computeProviders).values({
        name: "Local Docker",
        type: "docker-local",
        config: {},
        status: "connected",
      });

      const result = await selectNode();

      expect(result.provider).toBeNull();
      expect(result.fallbackToLocal).toBe(true);
    });

    it("should return fallback when Proxmox providers are offline (disabled)", async () => {
      await createProvider({ status: "disabled" });

      const result = await selectNode();

      expect(result.provider).toBeNull();
      expect(result.fallbackToLocal).toBe(true);
    });

    it("should return fallback when Proxmox providers are in error state", async () => {
      await createProvider({ status: "error" });

      const result = await selectNode();

      expect(result.provider).toBeNull();
      expect(result.fallbackToLocal).toBe(true);
    });

    it("should select the only available provider", async () => {
      const provider = await createProvider();
      mockGetNodeStatus.mockResolvedValue(mockNodeStatus());
      mockListLXCs.mockResolvedValue(mockLxcList(2));

      const result = await selectNode();

      expect(result.provider).not.toBeNull();
      expect(result.provider!.providerId).toBe(provider.id);
      expect(result.fallbackToLocal).toBe(false);
      expect(result.candidates).toHaveLength(1);
    });

    it("should select the least loaded provider when multiple exist", async () => {
      // Provider A: heavily loaded (80% memory, 60% CPU, 15 containers)
      const providerA = await createProvider({
        name: "Heavy Node",
        config: { ...baseConfig, host: "192.168.1.101" },
      });

      // Provider B: lightly loaded (20% memory, 10% CPU, 2 containers)
      const providerB = await createProvider({
        name: "Light Node",
        config: { ...baseConfig, host: "192.168.1.102" },
      });

      mockGetNodeStatus
        .mockResolvedValueOnce(
          mockNodeStatus({
            cpu: 0.6,
            mem: 12.8 * 1024 ** 3, // 80% of 16 GB
          }),
        )
        .mockResolvedValueOnce(
          mockNodeStatus({
            cpu: 0.1,
            mem: 3.2 * 1024 ** 3, // 20% of 16 GB
          }),
        );

      mockListLXCs
        .mockResolvedValueOnce(mockLxcList(15))
        .mockResolvedValueOnce(mockLxcList(2));

      const result = await selectNode();

      expect(result.provider).not.toBeNull();
      expect(result.provider!.providerId).toBe(providerB.id);
      expect(result.provider!.providerName).toBe("Light Node");
      expect(result.candidates).toHaveLength(2);
      // Light Node should have lower score
      expect(result.candidates[0]!.score).toBeLessThan(result.candidates[1]!.score);
    });

    it("should reject overloaded nodes (>95% memory)", async () => {
      await createProvider();
      mockGetNodeStatus.mockResolvedValue(
        mockNodeStatus({
          cpu: 0.3,
          mem: 15.5 * 1024 ** 3, // ~97% of 16 GB
        }),
      );
      mockListLXCs.mockResolvedValue(mockLxcList(5));

      const result = await selectNode();

      expect(result.provider).toBeNull();
      expect(result.fallbackToLocal).toBe(true);
      expect(result.reason).toContain("overloaded");
    });

    it("should reject overloaded nodes (>95% CPU)", async () => {
      await createProvider();
      mockGetNodeStatus.mockResolvedValue(mockNodeStatus({ cpu: 0.98 }));
      mockListLXCs.mockResolvedValue(mockLxcList(3));

      const result = await selectNode();

      expect(result.provider).toBeNull();
      expect(result.fallbackToLocal).toBe(true);
      expect(result.reason).toContain("overloaded");
    });

    it("should handle provider API failures gracefully", async () => {
      await createProvider({ name: "Failing Node" });
      mockGetNodeStatus.mockRejectedValue(new Error("Connection refused"));

      const result = await selectNode();

      expect(result.provider).toBeNull();
      expect(result.fallbackToLocal).toBe(true);
      expect(result.reason).toContain("failed health checks");
    });

    it("should succeed with remaining providers when some fail", async () => {
      // Provider A: fails
      await createProvider({
        name: "Failing Node",
        config: { ...baseConfig, host: "192.168.1.101" },
      });

      // Provider B: succeeds
      const providerB = await createProvider({
        name: "Working Node",
        config: { ...baseConfig, host: "192.168.1.102" },
      });

      mockGetNodeStatus
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce(mockNodeStatus());

      mockListLXCs
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce(mockLxcList(3));

      const result = await selectNode();

      expect(result.provider).not.toBeNull();
      expect(result.provider!.providerId).toBe(providerB.id);
      expect(result.candidates).toHaveLength(1); // only the working one
    });

    it("should exclude providers by ID", async () => {
      const providerA = await createProvider({
        name: "Node A",
        config: { ...baseConfig, host: "192.168.1.101" },
      });

      const providerB = await createProvider({
        name: "Node B",
        config: { ...baseConfig, host: "192.168.1.102" },
      });

      mockGetNodeStatus.mockResolvedValue(mockNodeStatus());
      mockListLXCs.mockResolvedValue(mockLxcList(1));

      const result = await selectNode(null, [providerA.id]);

      expect(result.provider).not.toBeNull();
      expect(result.provider!.providerId).toBe(providerB.id);
    });

    it("should prefer org-specific providers", async () => {
      // Create a real user and organization for FK constraints
      const user = await testUtils.createUser({ email: "sched@test.com" });
      const org = await testUtils.createOrganization(user.id);

      // Global provider (should be ignored when org provider exists)
      await createProvider({
        name: "Global Node",
        config: { ...baseConfig, host: "192.168.1.101" },
      });

      // Org-specific provider
      const orgProvider = await createProvider({
        name: "Org Node",
        organizationId: org.id,
        config: { ...baseConfig, host: "192.168.1.102" },
      });

      mockGetNodeStatus.mockResolvedValue(mockNodeStatus());
      mockListLXCs.mockResolvedValue(mockLxcList(1));

      const result = await selectNode(org.id);

      expect(result.provider).not.toBeNull();
      expect(result.provider!.providerId).toBe(orgProvider.id);
    });

    it("should fall back to global providers when org has none", async () => {
      const orgId = "00000000-0000-0000-0000-000000000010";

      // Global provider
      const globalProvider = await createProvider({
        name: "Global Node",
      });

      mockGetNodeStatus.mockResolvedValue(mockNodeStatus());
      mockListLXCs.mockResolvedValue(mockLxcList(1));

      const result = await selectNode(orgId);

      expect(result.provider).not.toBeNull();
      expect(result.provider!.providerId).toBe(globalProvider.id);
    });

    it("should include score and metrics in candidates", async () => {
      await createProvider();
      mockGetNodeStatus.mockResolvedValue(
        mockNodeStatus({ cpu: 0.25, mem: 8 * 1024 ** 3 }),
      );
      mockListLXCs.mockResolvedValue(mockLxcList(4));

      const result = await selectNode();

      expect(result.candidates).toHaveLength(1);
      const candidate = result.candidates[0]!;
      expect(candidate.cpuUsage).toBe(0.25);
      expect(candidate.cpuCores).toBe(8);
      expect(candidate.memoryUsage).toBe(0.5); // 8GB / 16GB
      expect(candidate.lxcCount).toBe(4);
      expect(candidate.score).toBeGreaterThan(0);
      expect(candidate.score).toBeLessThan(1);
    });
  });

  // =========================================================================
  // getNodeLoad
  // =========================================================================

  describe("getNodeLoad", () => {
    it("should return load metrics for a valid Proxmox provider", async () => {
      const provider = await createProvider();
      mockGetNodeStatus.mockResolvedValue(mockNodeStatus());
      mockListLXCs.mockResolvedValue(mockLxcList(5));

      const load = await getNodeLoad(provider.id);

      expect(load).not.toBeNull();
      expect(load!.providerId).toBe(provider.id);
      expect(load!.lxcCount).toBe(5);
      expect(load!.cpuUsage).toBe(0.2);
      expect(load!.cpuCores).toBe(8);
      expect(load!.memoryUsage).toBeCloseTo(0.25); // 4GB / 16GB
      expect(load!.score).toBeGreaterThan(0);
    });

    it("should return null for non-existent provider", async () => {
      const load = await getNodeLoad("00000000-0000-0000-0000-000000000099");
      expect(load).toBeNull();
    });

    it("should return null for non-Proxmox provider", async () => {
      const [dockerProvider] = await db
        .insert(computeProviders)
        .values({
          name: "Local Docker",
          type: "docker-local",
          config: {},
          status: "connected",
        })
        .returning();

      const load = await getNodeLoad(dockerProvider.id);
      expect(load).toBeNull();
    });

    it("should return null when API call fails", async () => {
      const provider = await createProvider();
      mockGetNodeStatus.mockRejectedValue(new Error("Connection refused"));

      const load = await getNodeLoad(provider.id);
      expect(load).toBeNull();
    });
  });
});
