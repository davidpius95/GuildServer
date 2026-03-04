import { describe, it, expect, beforeEach, jest } from '@jest/globals';
// superjson is mocked globally in tests/setup.ts

import { providerRouter } from '../../src/routers/provider';
import { db } from '../setup';
import { TRPCError } from '@trpc/server';
import { computeProviders, applications, users, organizations, projects, members } from '@guildserver/database';
import { eq } from 'drizzle-orm';

// Mock the provider factory to avoid real connections
jest.mock('../../src/providers/factory', () => ({
  createProviderFromConfig: jest.fn().mockImplementation((type: string) => {
    if (type === 'docker-local') {
      return {
        testConnection: jest.fn().mockResolvedValue({
          connected: true,
          message: 'Docker daemon is reachable',
        }),
      };
    }
    if (type === 'proxmox') {
      return {
        testConnection: jest.fn().mockResolvedValue({
          connected: true,
          message: 'Proxmox VE connected',
          details: { version: '8.0', nodes: ['pve1'] },
        }),
      };
    }
    // Unimplemented types throw
    throw new Error(`Provider type "${type}" is not yet implemented`);
  }),
}));

// Helper to create a test context that mimics what createContext() returns
function createTestContext(overrides: {
  user?: { id: string; email: string; name: string | null; role: 'admin' | 'user' | null };
  isAuthenticated?: boolean;
  isAdmin?: boolean;
} = {}) {
  return {
    db,
    req: {} as any,
    res: {} as any,
    user: overrides.user || null,
    isAuthenticated: overrides.isAuthenticated ?? !!overrides.user,
    isAdmin: overrides.isAdmin ?? (overrides.user?.role === 'admin'),
  };
}

// Create an admin context for admin-only endpoints
function createAdminContext(userId: string, email = 'admin@test.com') {
  return createTestContext({
    user: { id: userId, email, name: 'Admin User', role: 'admin' },
    isAuthenticated: true,
    isAdmin: true,
  });
}

// Create a regular authenticated user context
function createUserContext(userId: string, email = 'user@test.com') {
  return createTestContext({
    user: { id: userId, email, name: 'Regular User', role: 'user' },
    isAuthenticated: true,
    isAdmin: false,
  });
}

describe('ProviderRouter', () => {
  let adminUserId: string;
  let regularUserId: string;
  let testOrgId: string;

  beforeEach(async () => {
    // Create test users directly in DB for context
    const [adminUser] = await db
      .insert(users)
      .values({
        name: 'Admin User',
        email: `admin-${Date.now()}@test.com`,
        passwordHash: '$2a$10$testhashedpassword',
        role: 'admin',
      })
      .returning();
    adminUserId = adminUser.id;

    const [regularUser] = await db
      .insert(users)
      .values({
        name: 'Regular User',
        email: `user-${Date.now()}@test.com`,
        passwordHash: '$2a$10$testhashedpassword',
        role: 'user',
      })
      .returning();
    regularUserId = regularUser.id;

    // Create a test organization (ownerId is required)
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Test Org',
        slug: `test-org-${Date.now()}`,
        ownerId: adminUserId,
      } as any)
      .returning();
    testOrgId = org.id;
  });

  // ============================
  // listAvailable
  // ============================
  describe('listAvailable', () => {
    it('should return all 9 provider types', async () => {
      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      const result = await caller.listAvailable();

      expect(result).toHaveLength(9);

      const types = result.map((p) => p.type);
      expect(types).toContain('docker-local');
      expect(types).toContain('docker-remote');
      expect(types).toContain('proxmox');
      expect(types).toContain('kubernetes');
      expect(types).toContain('aws-ecs');
      expect(types).toContain('gcp-cloudrun');
      expect(types).toContain('azure-aci');
      expect(types).toContain('hetzner');
      expect(types).toContain('digitalocean');
    });

    it('should mark docker-local and proxmox as implemented', async () => {
      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      const result = await caller.listAvailable();

      const dockerLocal = result.find((p) => p.type === 'docker-local');
      const proxmox = result.find((p) => p.type === 'proxmox');
      const awsEcs = result.find((p) => p.type === 'aws-ecs');

      expect(dockerLocal?.implemented).toBe(true);
      expect(proxmox?.implemented).toBe(true);
      expect(awsEcs?.implemented).toBe(false);
    });

    it('should require authentication', async () => {
      const caller = providerRouter.createCaller(createTestContext());

      await expect(caller.listAvailable()).rejects.toThrow();
    });
  });

  // ============================
  // list
  // ============================
  describe('list', () => {
    it('should return empty array when no providers exist', async () => {
      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      const result = await caller.list();

      expect(result).toEqual([]);
    });

    it('should return providers with config stripped', async () => {
      // Insert a provider directly into DB
      await db.insert(computeProviders).values({
        name: 'Test Docker',
        type: 'docker-local',
        config: { socketPath: '/var/run/docker.sock' },
        status: 'connected',
      });

      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      const result = await caller.list();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Docker');
      expect(result[0].type).toBe('docker-local');
      // Config should always be empty object (credential redaction)
      expect(result[0].config).toEqual({});
    });

    it('should return multiple providers ordered by creation date', async () => {
      await db.insert(computeProviders).values([
        {
          name: 'Provider A',
          type: 'docker-local',
          config: {},
          status: 'connected',
        },
        {
          name: 'Provider B',
          type: 'proxmox',
          config: { host: '10.0.0.1' },
          status: 'error',
        },
      ]);

      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      const result = await caller.list();

      expect(result).toHaveLength(2);
      // All configs should be redacted
      result.forEach((p) => {
        expect(p.config).toEqual({});
      });
    });

    it('should require authentication', async () => {
      const caller = providerRouter.createCaller(createTestContext());

      await expect(caller.list()).rejects.toThrow();
    });
  });

  // ============================
  // create
  // ============================
  describe('create', () => {
    it('should create a docker-local provider successfully', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.create({
        name: 'My Docker',
        type: 'docker-local',
        config: {},
      });

      expect(result.name).toBe('My Docker');
      expect(result.type).toBe('docker-local');
      expect(result.status).toBe('connected');
      expect(result.config).toEqual({}); // credential redaction
      expect(result.id).toBeDefined();
    });

    it('should create a proxmox provider and test connection', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.create({
        name: 'My Proxmox',
        type: 'proxmox',
        config: {
          host: '10.0.0.1',
          port: 8006,
          tokenId: 'root@pam!test',
          tokenSecret: 'secret-token-value',
        },
      });

      expect(result.name).toBe('My Proxmox');
      expect(result.type).toBe('proxmox');
      expect(result.status).toBe('connected');
      expect(result.config).toEqual({}); // credentials must be redacted
    });

    it('should set status to error when provider type is not implemented', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.create({
        name: 'My AWS',
        type: 'aws-ecs',
        config: {},
      });

      // Unimplemented providers should still be created but with error status
      expect(result.name).toBe('My AWS');
      expect(result.type).toBe('aws-ecs');
      expect(result.status).toBe('error');
      expect(result.healthMessage).toContain('not yet implemented');
    });

    it('should store provider in database with real config (not redacted)', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      await caller.create({
        name: 'Stored Provider',
        type: 'docker-local',
        config: { socketPath: '/custom/docker.sock' },
      });

      // Directly query DB to verify config is stored
      const [dbProvider] = await db
        .select()
        .from(computeProviders)
        .where(eq(computeProviders.name, 'Stored Provider'));

      expect(dbProvider).toBeDefined();
      expect((dbProvider.config as any).socketPath).toBe('/custom/docker.sock');
    });

    it('should set region and isDefault', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.create({
        name: 'Regional Provider',
        type: 'docker-local',
        config: {},
        region: 'us-east-1',
        isDefault: true,
        organizationId: testOrgId,
      });

      expect(result.region).toBe('us-east-1');
      expect(result.isDefault).toBe(true);
    });

    it('should require admin role', async () => {
      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      await expect(
        caller.create({
          name: 'Forbidden Provider',
          type: 'docker-local',
          config: {},
        })
      ).rejects.toThrow();
    });

    it('should require authentication', async () => {
      const caller = providerRouter.createCaller(createTestContext());

      await expect(
        caller.create({
          name: 'Unauthed Provider',
          type: 'docker-local',
          config: {},
        })
      ).rejects.toThrow();
    });

    it('should validate input - name is required', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      await expect(
        caller.create({
          name: '',
          type: 'docker-local',
          config: {},
        })
      ).rejects.toThrow();
    });
  });

  // ============================
  // getById
  // ============================
  describe('getById', () => {
    it('should return provider by ID with config redacted', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'Findable Provider',
          type: 'proxmox',
          config: { host: '10.0.0.1', tokenSecret: 'super-secret' },
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      const result = await caller.getById({ id: provider.id });

      expect(result.id).toBe(provider.id);
      expect(result.name).toBe('Findable Provider');
      expect(result.type).toBe('proxmox');
      expect(result.config).toEqual({}); // credentials redacted
    });

    it('should throw NOT_FOUND for non-existent provider', async () => {
      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      await expect(
        caller.getById({ id: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow('Provider not found');
    });

    it('should require authentication', async () => {
      const caller = providerRouter.createCaller(createTestContext());

      await expect(
        caller.getById({ id: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow();
    });
  });

  // ============================
  // update
  // ============================
  describe('update', () => {
    it('should update provider name', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'Old Name',
          type: 'docker-local',
          config: {},
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.update({
        id: provider.id,
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
      expect(result.config).toEqual({}); // still redacted
    });

    it('should update provider region', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'Regional',
          type: 'proxmox',
          config: {},
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.update({
        id: provider.id,
        region: 'eu-west-1',
      });

      expect(result.region).toBe('eu-west-1');
    });

    it('should throw NOT_FOUND for non-existent provider', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      await expect(
        caller.update({
          id: '00000000-0000-0000-0000-000000000000',
          name: 'Updated',
        })
      ).rejects.toThrow('Provider not found');
    });

    it('should require admin role', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'No Update',
          type: 'docker-local',
          config: {},
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      await expect(
        caller.update({ id: provider.id, name: 'Forbidden' })
      ).rejects.toThrow();
    });
  });

  // ============================
  // delete
  // ============================
  describe('delete', () => {
    it('should delete a provider', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'To Delete',
          type: 'docker-local',
          config: {},
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.delete({ id: provider.id });

      expect(result.success).toBe(true);

      // Verify it's gone from DB
      const found = await db.query.computeProviders.findFirst({
        where: eq(computeProviders.id, provider.id),
      });
      expect(found).toBeUndefined();
    });

    it('should block deletion when apps are using the provider', async () => {
      // Create a provider
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'In Use',
          type: 'docker-local',
          config: {},
          status: 'connected',
        })
        .returning();

      // Create a project for the application
      const [project] = await db
        .insert(projects)
        .values({
          name: 'Test Project',
          description: 'Test',
          organizationId: testOrgId,
        })
        .returning();

      // Create an application that references this provider
      await db.insert(applications).values({
        name: 'linked-app',
        appName: 'Linked App',
        projectId: project.id,
        sourceType: 'github',
        repository: 'https://github.com/test/app',
        providerId: provider.id,
      });

      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      await expect(caller.delete({ id: provider.id })).rejects.toThrow(
        /Cannot delete this provider/
      );
    });

    it('should require admin role', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'No Delete',
          type: 'docker-local',
          config: {},
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      await expect(
        caller.delete({ id: provider.id })
      ).rejects.toThrow();
    });
  });

  // ============================
  // testConnection
  // ============================
  describe('testConnection', () => {
    it('should test connection and update DB status', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'Test Connection',
          type: 'docker-local',
          config: {},
          status: 'pending' as any,
        })
        .returning();

      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.testConnection({ id: provider.id });

      expect(result.connected).toBe(true);
      expect(result.message).toBe('Docker daemon is reachable');

      // Verify DB was updated
      const [updated] = await db
        .select()
        .from(computeProviders)
        .where(eq(computeProviders.id, provider.id));

      expect(updated.status).toBe('connected');
      expect(updated.lastHealthCheck).toBeDefined();
    });

    it('should handle connection failure gracefully', async () => {
      // Override mock for this test to simulate failure
      const { createProviderFromConfig } = require('../../src/providers/factory');
      (createProviderFromConfig as jest.Mock).mockImplementationOnce(() => ({
        testConnection: jest.fn().mockResolvedValue({
          connected: false,
          message: 'Connection refused',
        }),
      }));

      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'Failing Provider',
          type: 'docker-local',
          config: {},
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const result = await caller.testConnection({ id: provider.id });

      expect(result.connected).toBe(false);
      expect(result.message).toBe('Connection refused');

      // Verify DB was updated to error
      const [updated] = await db
        .select()
        .from(computeProviders)
        .where(eq(computeProviders.id, provider.id));

      expect(updated.status).toBe('error');
    });

    it('should throw NOT_FOUND for non-existent provider', async () => {
      const caller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      await expect(
        caller.testConnection({ id: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow('Provider not found');
    });

    it('should require admin role', async () => {
      const [provider] = await db
        .insert(computeProviders)
        .values({
          name: 'No Access',
          type: 'docker-local',
          config: {},
          status: 'connected',
        })
        .returning();

      const caller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      await expect(
        caller.testConnection({ id: provider.id })
      ).rejects.toThrow();
    });
  });

  // ============================
  // Credential redaction (cross-cutting)
  // ============================
  describe('credential redaction', () => {
    it('should never expose config in any response', async () => {
      const sensitiveConfig = {
        host: '10.0.0.1',
        tokenId: 'root@pam!api',
        tokenSecret: 'super-secret-token-12345',
        password: 'admin123',
      };

      // Create via admin
      const adminCaller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );

      const created = await adminCaller.create({
        name: 'Sensitive Provider',
        type: 'proxmox',
        config: sensitiveConfig,
      });

      // Verify create response has empty config
      expect(created.config).toEqual({});
      expect(JSON.stringify(created)).not.toContain('super-secret');

      // Verify list response has empty config
      const userCaller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );
      const listed = await userCaller.list();
      const found = listed.find((p) => p.id === created.id);
      expect(found?.config).toEqual({});
      expect(JSON.stringify(found)).not.toContain('super-secret');

      // Verify getById response has empty config
      const fetched = await userCaller.getById({ id: created.id });
      expect(fetched.config).toEqual({});
      expect(JSON.stringify(fetched)).not.toContain('super-secret');

      // Verify update response has empty config
      const updated = await adminCaller.update({
        id: created.id,
        name: 'Updated Sensitive Provider',
      });
      expect(updated.config).toEqual({});
      expect(JSON.stringify(updated)).not.toContain('super-secret');
    });
  });

  // ============================
  // Full CRUD lifecycle
  // ============================
  describe('full lifecycle', () => {
    it('should support create -> read -> update -> test -> delete flow', async () => {
      const adminCaller = providerRouter.createCaller(
        createAdminContext(adminUserId)
      );
      const userCaller = providerRouter.createCaller(
        createUserContext(regularUserId)
      );

      // 1. Create
      const created = await adminCaller.create({
        name: 'Lifecycle Provider',
        type: 'docker-local',
        config: {},
        region: 'local',
      });
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Lifecycle Provider');

      // 2. Read (list)
      const list1 = await userCaller.list();
      expect(list1.some((p) => p.id === created.id)).toBe(true);

      // 3. Read (getById)
      const fetched = await userCaller.getById({ id: created.id });
      expect(fetched.name).toBe('Lifecycle Provider');

      // 4. Update
      const updated = await adminCaller.update({
        id: created.id,
        name: 'Updated Lifecycle Provider',
        region: 'us-west-2',
      });
      expect(updated.name).toBe('Updated Lifecycle Provider');
      expect(updated.region).toBe('us-west-2');

      // 5. Test connection
      const testResult = await adminCaller.testConnection({ id: created.id });
      expect(testResult.connected).toBe(true);

      // 6. Delete
      const deleted = await adminCaller.delete({ id: created.id });
      expect(deleted.success).toBe(true);

      // 7. Verify deletion
      const list2 = await userCaller.list();
      expect(list2.some((p) => p.id === created.id)).toBe(false);

      // 8. getById should now throw
      await expect(
        userCaller.getById({ id: created.id })
      ).rejects.toThrow('Provider not found');
    });
  });
});
