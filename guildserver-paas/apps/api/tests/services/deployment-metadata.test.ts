/**
 * Deployment Provider Metadata Tests
 *
 * Verifies that the deployments table properly stores and retrieves
 * provider metadata (lxcVmId, providerId, providerMetadata JSON)
 * that are used by the Proxmox provider for VMID lookups.
 */

import { db, testUtils } from "../setup";
import {
  deployments,
  applications,
  computeProviders,
} from "@guildserver/database";
import { eq, desc, and, isNotNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestApp(projectId: string) {
  const [app] = await db
    .insert(applications)
    .values({
      name: "Test App",
      appName: "test-app",
      projectId,
      sourceType: "docker",
      dockerImage: "nginx",
      dockerTag: "latest",
      deploymentTarget: "proxmox",
      status: "running",
    })
    .returning();
  return app;
}

async function createTestProvider(overrides: Record<string, unknown> = {}) {
  const [provider] = await db
    .insert(computeProviders)
    .values({
      name: "Test Proxmox",
      type: "proxmox",
      config: {
        host: "192.168.1.100",
        port: 8006,
        tokenId: "root@pam!test",
        tokenSecret: "secret",
        node: "pve",
        storage: "local-lvm",
        bridge: "vmbr0",
      },
      status: "connected",
      ...overrides,
    })
    .returning();
  return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Deployment Provider Metadata", () => {
  let testUser: any;
  let testOrg: any;
  let testProject: any;

  beforeEach(async () => {
    testUser = await testUtils.createUser({ email: "deploy-meta@test.com" });
    testOrg = await testUtils.createOrganization(testUser.id);
    testProject = await testUtils.createProject(testOrg.id);
  });

  describe("schema", () => {
    it("should store lxcVmId on a deployment", async () => {
      const app = await createTestApp(testProject.id);

      const [deployment] = await db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "completed",
          lxcVmId: 150,
        })
        .returning();

      expect(deployment.lxcVmId).toBe(150);
    });

    it("should store providerId on a deployment", async () => {
      const app = await createTestApp(testProject.id);
      const provider = await createTestProvider();

      const [deployment] = await db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "completed",
          providerId: provider.id,
          lxcVmId: 200,
        })
        .returning();

      expect(deployment.providerId).toBe(provider.id);
      expect(deployment.lxcVmId).toBe(200);
    });

    it("should store providerMetadata as JSON", async () => {
      const app = await createTestApp(testProject.id);

      const metadata = {
        provider: "proxmox",
        vmid: 250,
        node: "pve",
        hostname: "gs-test-app",
        lxcIp: "192.168.1.50",
        storage: "local-lvm",
        bridge: "vmbr0",
        dockerContainerId: "abc123",
        dockerContainerName: "gs-test-app-deploy-1",
        dockerHostPort: 10001,
      };

      const [deployment] = await db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "completed",
          lxcVmId: 250,
          providerMetadata: metadata,
        })
        .returning();

      expect(deployment.providerMetadata).toBeDefined();
      const stored = deployment.providerMetadata as Record<string, unknown>;
      expect(stored.provider).toBe("proxmox");
      expect(stored.vmid).toBe(250);
      expect(stored.lxcIp).toBe("192.168.1.50");
      expect(stored.dockerContainerId).toBe("abc123");
      expect(stored.hostname).toBe("gs-test-app");
    });

    it("should allow null lxcVmId for local Docker deployments", async () => {
      const app = await createTestApp(testProject.id);

      const [deployment] = await db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "completed",
        })
        .returning();

      expect(deployment.lxcVmId).toBeNull();
      expect(deployment.providerId).toBeNull();
      expect(deployment.providerMetadata).toBeNull();
    });
  });

  describe("VMID lookup query", () => {
    it("should find the latest deployment's lxcVmId for an app", async () => {
      const app = await createTestApp(testProject.id);

      // Insert older deployment
      await db.insert(deployments).values({
        applicationId: app.id,
        status: "completed",
        lxcVmId: 100,
        createdAt: new Date("2024-01-01"),
      });

      // Insert newer deployment with different VMID
      await db.insert(deployments).values({
        applicationId: app.id,
        status: "completed",
        lxcVmId: 200,
        createdAt: new Date("2024-06-01"),
      });

      // Query the same way ProxmoxProvider.findVMIDForApp does
      const result = await db.query.deployments.findFirst({
        where: and(
          eq(deployments.applicationId, app.id),
          isNotNull(deployments.lxcVmId),
        ),
        orderBy: [desc(deployments.createdAt)],
        columns: { lxcVmId: true },
      });

      expect(result).not.toBeNull();
      expect(result!.lxcVmId).toBe(200); // should return the latest
    });

    it("should return null when no deployments have lxcVmId", async () => {
      const app = await createTestApp(testProject.id);

      // Local Docker deployment (no VMID)
      await db.insert(deployments).values({
        applicationId: app.id,
        status: "completed",
      });

      const result = await db.query.deployments.findFirst({
        where: and(
          eq(deployments.applicationId, app.id),
          isNotNull(deployments.lxcVmId),
        ),
        orderBy: [desc(deployments.createdAt)],
        columns: { lxcVmId: true },
      });

      expect(result).toBeUndefined();
    });

    it("should handle provider cascade on delete", async () => {
      const app = await createTestApp(testProject.id);
      const provider = await createTestProvider({ name: "Cascade Test" });

      const [deployment] = await db
        .insert(deployments)
        .values({
          applicationId: app.id,
          status: "completed",
          providerId: provider.id,
          lxcVmId: 300,
        })
        .returning();

      // Delete the provider
      await db
        .delete(computeProviders)
        .where(eq(computeProviders.id, provider.id));

      // Deployment should still exist but providerId should be null
      const updated = await db.query.deployments.findFirst({
        where: eq(deployments.id, deployment.id),
      });

      expect(updated).not.toBeNull();
      expect(updated!.providerId).toBeNull();
      // lxcVmId should still be preserved
      expect(updated!.lxcVmId).toBe(300);
    });
  });

  describe("deployment target tracking", () => {
    it("should track deploymentTarget on applications", async () => {
      const [proxmoxApp] = await db
        .insert(applications)
        .values({
          name: "Proxmox App",
          appName: "proxmox-app",
          projectId: testProject.id,
          sourceType: "docker",
          dockerImage: "nginx",
          deploymentTarget: "proxmox",
        })
        .returning();

      const [localApp] = await db
        .insert(applications)
        .values({
          name: "Local App",
          appName: "local-app",
          projectId: testProject.id,
          sourceType: "docker",
          dockerImage: "nginx",
          deploymentTarget: "docker-local",
        })
        .returning();

      expect(proxmoxApp.deploymentTarget).toBe("proxmox");
      expect(localApp.deploymentTarget).toBe("docker-local");
    });

    it("should link application to a specific provider", async () => {
      const provider = await createTestProvider({ name: "App Provider" });

      const [app] = await db
        .insert(applications)
        .values({
          name: "Provider-linked App",
          appName: "provider-linked-app",
          projectId: testProject.id,
          sourceType: "docker",
          dockerImage: "nginx",
          deploymentTarget: "proxmox",
          providerId: provider.id,
        })
        .returning();

      expect(app.deploymentTarget).toBe("proxmox");
      expect(app.providerId).toBe(provider.id);
    });
  });
});
