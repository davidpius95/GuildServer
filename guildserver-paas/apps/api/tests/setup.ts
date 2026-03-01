import { beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@guildserver/database';

// Test database connection
const testDb = postgres(process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/guildserver_test', {
  max: 1,
});

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
    'applications',
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
  createUser: async (overrides = {}) => {
    const defaultUser = {
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      passwordHash: '$2a$10$testhashedpassword',
      ...overrides,
    };

    const [user] = await db.insert(schema.users).values(defaultUser).returning();
    return user;
  },

  createOrganization: async (overrides = {}) => {
    const defaultOrg = {
      name: 'Test Organization',
      slug: `test-org-${Date.now()}`,
      ...overrides,
    };

    const [org] = await db.insert(schema.organizations).values(defaultOrg).returning();
    return org;
  },

  createMember: async (userId: string, organizationId: string, role = 'developer') => {
    const [member] = await db.insert(schema.members).values({
      userId,
      organizationId,
      role,
    }).returning();
    return member;
  },

  createProject: async (organizationId: string, overrides = {}) => {
    const defaultProject = {
      name: 'Test Project',
      description: 'Test project description',
      organizationId,
      ...overrides,
    };

    const [project] = await db.insert(schema.projects).values(defaultProject).returning();
    return project;
  },

  createApplication: async (projectId: string, overrides = {}) => {
    const defaultApp = {
      name: 'test-app',
      appName: 'Test Application',
      projectId,
      sourceType: 'github' as const,
      repository: 'https://github.com/test/repo',
      ...overrides,
    };

    const [app] = await db.insert(schema.applications).values(defaultApp).returning();
    return app;
  },

  // Helper to create a complete test setup (user, org, project, app)
  createTestSetup: async () => {
    const user = await testUtils.createUser();
    const org = await testUtils.createOrganization();
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
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/guildserver_test';
process.env.REDIS_URL = 'redis://localhost:6379/1'; // Use different Redis DB for tests