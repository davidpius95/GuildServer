// Jest globals are provided by @types/jest — no import needed

// Mock ESM-only packages globally so all test files can import router modules
jest.mock('superjson', () => ({
  __esModule: true,
  default: {
    serialize: (v: any) => ({ json: v, meta: undefined }),
    deserialize: (v: any) => v.json ?? v,
    stringify: (v: any) => JSON.stringify(v),
    parse: (v: any) => JSON.parse(v),
    registerCustom: jest.fn(),
    allowErrorProps: jest.fn(),
  },
  serialize: (v: any) => ({ json: v, meta: undefined }),
  deserialize: (v: any) => v.json ?? v,
}));

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@guildserver/database';

// The URL is resolved and validated in tests/env.ts (jest `setupFiles`), which
// runs before any module — including @guildserver/database — is imported.
import { resolveTestDatabaseUrl } from './test-database-url';

const testDbUrl = resolveTestDatabaseUrl();
const testDb = postgres(testDbUrl, {
  max: 1,
});
const skipTestDbCleanup = process.env.GUILDSERVER_SKIP_TEST_DB === '1';

export const db = drizzle(testDb, { schema });

// Global test setup
beforeAll(async () => {
  // Run migrations or setup test database schema
  console.log('Setting up test database...');
});

afterAll(async () => {
  // Close database connections
  await testDb.end();
  console.log('Test database connections closed');
});

beforeEach(async () => {
  if (skipTestDbCleanup) return;
  // Clear test data before each test
  await clearTestData();
});

afterEach(async () => {
  // Additional cleanup if needed
});

async function clearTestData() {
  // Clear all tables in reverse dependency order
  const tables = [
    'audit_logs',
    'k8s_deployments',
    'kubernetes_clusters',
    'deployments',
    // Compose stacks. Listed before `services` so the cascade is explicit
    // rather than implied.
    'service_containers',
    'service_volumes',
    'services',
    'applications',
    'compute_providers',
    'databases',
    'projects',
    'members',
    'organizations',
    'users',
  ];

  for (const table of tables) {
    try {
      await testDb`DELETE FROM ${testDb(table)}`;
    } catch (error) {
      // Table might not exist in test schema, ignore
    }
  }
}

// Test utilities
export const testUtils = {
  createUser: async (overrides: Record<string, any> = {}) => {
    const defaultUser = {
      name: 'Test User',
      email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: '$2a$10$testhashedpassword',
      ...overrides,
    };

    const [user] = await db.insert(schema.users).values(defaultUser as any).returning();
    return user;
  },

  createOrganization: async (ownerId: string, overrides: Record<string, any> = {}) => {
    const defaultOrg = {
      name: 'Test Organization',
      slug: `test-org-${Date.now()}`,
      ownerId,
      ...overrides,
    };

    const [org] = await db.insert(schema.organizations).values(defaultOrg as any).returning();
    return org;
  },

  createMember: async (userId: string, organizationId: string, role: 'owner' | 'admin' | 'member' = 'member') => {
    const [member] = await db.insert(schema.members).values({
      userId,
      organizationId,
      role,
    } as any).returning();
    return member;
  },

  createProject: async (organizationId: string, overrides: Record<string, any> = {}) => {
    const defaultProject = {
      name: 'Test Project',
      description: 'Test project description',
      organizationId,
      ...overrides,
    };

    const [project] = await db.insert(schema.projects).values(defaultProject as any).returning();
    return project;
  },

  createApplication: async (projectId: string, overrides: Record<string, any> = {}) => {
    const defaultApp = {
      name: 'test-app',
      appName: 'Test Application',
      projectId,
      sourceType: 'github' as const,
      repository: 'https://github.com/test/repo',
      ...overrides,
    };

    const [app] = await db.insert(schema.applications).values(defaultApp as any).returning();
    return app;
  },

  // Helper to create a complete test setup (user, org, project, app)
  createTestSetup: async () => {
    const user = await testUtils.createUser();
    const org = await testUtils.createOrganization(user.id);
    const member = await testUtils.createMember(user.id, org.id, 'owner');
    const project = await testUtils.createProject(org.id);
    const app = await testUtils.createApplication(project.id);

    return { user, org, member, project, app };
  },
};

// Mock external services
export const mockServices = {
  kubernetes: {
    connectCluster: jest.fn(),
    deployApplication: jest.fn(),
    getClusterMetrics: jest.fn(),
  },
  cicd: {
    triggerPipeline: jest.fn(),
    createPipeline: jest.fn(),
  },
  compliance: {
    runAssessment: jest.fn(),
    generateReport: jest.fn(),
  },
};

// Environment setup
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.DATABASE_URL = testDbUrl;
// REDIS_URL is set once, in tests/env.ts, to the throwaway Redis on 6380.
// This file used to overwrite it with redis://localhost:6379/1 after env.ts ran:
// the default Redis port, which on a single-node install is the one the live
// control plane's queues use. It was unreachable from the host here, so tests
// that needed Redis simply failed; had it been reachable, they would have
// written into production's Redis.
