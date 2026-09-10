import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { services, serviceContainers, serviceVolumes, deployments } from '@guildserver/database';
import { db, testUtils } from '../setup';

// The queue module opens Redis connections and starts BullMQ workers at import
// time, so it is replaced wholesale rather than connected to.
const queueAdd = jest.fn(async () => ({ id: 'job-1' }));
jest.mock('../../src/queues/deployment', () => ({ deploymentQueue: { add: queueAdd } }));
jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

const removeStackMock = jest.fn(async () => ({ removedVolumes: [], failedVolumes: [], sweptContainers: [] }));
const stopStackMock = jest.fn(async () => ({ code: 0, stdout: 'stopped', stderr: '' }));
const restartStackMock = jest.fn(async () => ({ code: 0, stdout: 'restarted', stderr: '' }));
const getStackLogsMock = jest.fn(async () => ['line one', 'line two']);
const reconcileMock = jest.fn(async () => []);

jest.mock('../../src/services/compose/deploy', () => ({
  removeStack: (...args: any[]) => (removeStackMock as any)(...args),
  stopStack: (...args: any[]) => (stopStackMock as any)(...args),
  restartStack: (...args: any[]) => (restartStackMock as any)(...args),
  getStackLogs: (...args: any[]) => (getStackLogsMock as any)(...args),
  reconcileContainers: (...args: any[]) => (reconcileMock as any)(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { serviceRouter } = require('../../src/routers/service');

const createTestContext = (user?: any) => ({
  db,
  req: {} as any,
  res: {} as any,
  user: user ?? null,
  isAuthenticated: !!user,
  isAdmin: user?.role === 'admin',
});

const VALID_STACK = `
services:
  web:
    image: nginx:1.27
    expose: ["80"]
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: \${SERVICE_PASSWORD_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
`;

/** An owner plus a second, unrelated organization to check scoping against. */
async function twoTenants() {
  const owner = await testUtils.createUser();
  const org = await testUtils.createOrganization(owner.id);
  await testUtils.createMember(owner.id, org.id, 'owner');
  const project = await testUtils.createProject(org.id);

  const outsider = await testUtils.createUser();
  const otherOrg = await testUtils.createOrganization(outsider.id);
  await testUtils.createMember(outsider.id, otherOrg.id, 'owner');
  const otherProject = await testUtils.createProject(otherOrg.id);

  return { owner, org, project, outsider, otherOrg, otherProject };
}

async function seedStack(projectId: string, overrides: Record<string, any> = {}) {
  const [stack] = await db
    .insert(services)
    .values({
      name: 'Seeded Stack',
      serviceName: 'seeded-stack',
      projectId,
      composeFile: VALID_STACK,
      environment: {},
      domains: {},
      ...overrides,
    } as any)
    .returning();
  return stack;
}

describe('serviceRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('summarises a valid stack without saving anything', async () => {
      const owner = await testUtils.createUser();
      const caller = serviceRouter.createCaller(createTestContext(owner));

      const result = await caller.validate({ composeFile: VALID_STACK });
      expect(result.valid).toBe(true);
      expect(result.services.map((s: any) => s.name)).toEqual(['web', 'db']);
      expect(result.volumes).toEqual(['pgdata']);
      expect(await db.select().from(services)).toHaveLength(0);
    });

    it('returns the problem list instead of throwing, so the editor can render it', async () => {
      const owner = await testUtils.createUser();
      const caller = serviceRouter.createCaller(createTestContext(owner));

      const result = await caller.validate({
        composeFile: 'services:\n  a:\n    image: nginx\n    privileged: true\n    network_mode: host\n',
      });
      expect(result.valid).toBe(false);
      expect(result.problems).toHaveLength(2);
    });
  });

  describe('create', () => {
    it('creates a stack in a project the caller belongs to', async () => {
      const { owner, project } = await twoTenants();
      const caller = serviceRouter.createCaller(createTestContext(owner));

      const stack = await caller.create({
        name: 'My Blog',
        projectId: project.id,
        composeFile: VALID_STACK,
        environment: { TZ: 'UTC' },
        domains: { web: ['blog.example.com'] },
      });

      expect(stack.name).toBe('My Blog');
      expect(stack.serviceName).toBe('my-blog');
      expect(stack.status).toBe('inactive');
      expect(stack.templateId).toBe('custom');
    });

    it('refuses a project in another organization', async () => {
      const { outsider, project } = await twoTenants();
      const caller = serviceRouter.createCaller(createTestContext(outsider));

      await expect(
        caller.create({ name: 'x', projectId: project.id, composeFile: VALID_STACK, environment: {}, domains: {} }),
      ).rejects.toThrow("You don't have access to this project");

      expect(await db.select().from(services)).toHaveLength(0);
    });

    it('rejects a Compose file at save time rather than at deploy time', async () => {
      const { owner, project } = await twoTenants();
      const caller = serviceRouter.createCaller(createTestContext(owner));

      await expect(
        caller.create({
          name: 'bad',
          projectId: project.id,
          composeFile: 'services:\n  a:\n    image: nginx\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n',
          environment: {},
          domains: {},
        }),
      ).rejects.toThrow(/docker/i);

      expect(await db.select().from(services)).toHaveLength(0);
    });

    it('requires authentication', async () => {
      const caller = serviceRouter.createCaller(createTestContext(null));
      await expect(caller.validate({ composeFile: VALID_STACK })).rejects.toThrow();
    });
  });

  describe('org scoping', () => {
    /**
     * Every read and write path, checked against the same outsider.
     *
     * A single unscoped lookup anywhere in this router is a cross-tenant read
     * or, for the mutations, a cross-tenant delete — so the check is applied to
     * the whole surface rather than to a representative procedure.
     */
    it('denies every stack-addressed procedure to a user in another organization', async () => {
      const { project, outsider } = await twoTenants();
      const stack = await seedStack(project.id);
      const caller = serviceRouter.createCaller(createTestContext(outsider));

      await expect(caller.getById({ id: stack.id })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.preview({ id: stack.id })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.status({ id: stack.id })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.logs({ id: stack.id, tail: 10 })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.deploy({ id: stack.id })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.stop({ id: stack.id })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.restart({ id: stack.id })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.update({ id: stack.id, name: 'hijacked' })).rejects.toThrow('Stack not found or access denied');
      await expect(caller.delete({ id: stack.id, removeVolumes: true })).rejects.toThrow(
        'Stack not found or access denied',
      );

      // Nothing was executed on the outsider's behalf.
      expect(removeStackMock).not.toHaveBeenCalled();
      expect(stopStackMock).not.toHaveBeenCalled();
      expect(restartStackMock).not.toHaveBeenCalled();
      expect(getStackLogsMock).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled();
      expect(await db.select().from(services).where(eq(services.id, stack.id))).toHaveLength(1);
    });

    it('does not leak stacks from another organization in list', async () => {
      const { owner, project, otherProject } = await twoTenants();
      await seedStack(project.id, { name: 'Mine' });
      await seedStack(otherProject.id, { name: 'Theirs' });

      const caller = serviceRouter.createCaller(createTestContext(owner));
      const mine = await caller.list({ projectId: project.id });
      expect(mine.map((s: any) => s.name)).toEqual(['Mine']);

      await expect(caller.list({ projectId: otherProject.id })).rejects.toThrow(
        "You don't have access to this project",
      );
    });

    it('reports a stack with no project as not found rather than as accessible', async () => {
      // Failing closed: a stack with no project has no organization and
      // therefore nobody who may act on it.
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);
      await db.update(services).set({ projectId: null }).where(eq(services.id, stack.id));

      const caller = serviceRouter.createCaller(createTestContext(owner));
      await expect(caller.getById({ id: stack.id })).rejects.toThrow('Stack not found or access denied');
    });
  });

  describe('getById', () => {
    it('returns containers, volumes and recent deployments', async () => {
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);
      await db.insert(serviceContainers).values([
        { serviceId: stack.id, composeServiceName: 'web', status: 'running' },
        { serviceId: stack.id, composeServiceName: 'db', status: 'running' },
      ] as any);
      await db.insert(serviceVolumes).values([
        { serviceId: stack.id, composeVolumeName: 'pgdata', volumeName: 'ns_pgdata', managed: true },
      ] as any);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      const result = await caller.getById({ id: stack.id });

      expect(result.containers.map((c: any) => c.composeServiceName)).toEqual(['db', 'web']);
      expect(result.volumes).toHaveLength(1);
      expect(result.deployments).toEqual([]);
    });
  });

  describe('preview', () => {
    it('shows the namespaced names and lists generated variables by name only', async () => {
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      const preview = await caller.preview({ id: stack.id });

      expect(preview.project).toContain('gs-svc-seeded-stack-');
      expect(preview.services.map((s: any) => s.containerName)).toEqual([
        `${preview.project}-web`,
        `${preview.project}-db`,
      ]);
      expect(preview.generatedVariables).toEqual(['SERVICE_PASSWORD_DB']);
      // The values themselves are not in the response.
      expect(JSON.stringify(preview)).not.toContain('SERVICE_PASSWORD_DB=');
      expect(preview.composeResolved).not.toMatch(/POSTGRES_PASSWORD: \$\{/);
    });
  });

  describe('deploy', () => {
    it('creates a deployment row and enqueues a deploy-service job', async () => {
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      const deployment = await caller.deploy({ id: stack.id });

      expect(deployment.serviceId).toBe(stack.id);
      expect(deployment.status).toBe('pending');
      expect(queueAdd).toHaveBeenCalledWith(
        'deploy-service',
        { deploymentId: deployment.id, serviceId: stack.id, userId: owner.id },
        expect.any(Object),
      );

      const rows = await db.select().from(deployments).where(eq(deployments.serviceId, stack.id));
      expect(rows).toHaveLength(1);
    });

    it('refuses to enqueue a stack that cannot be normalised', async () => {
      const { owner, project } = await twoTenants();
      // Saved before a rule tightened, or edited around validation.
      const stack = await seedStack(project.id, { composeFile: 'services:\n  a:\n    image: ${UNSET_IMAGE}\n' });

      const caller = serviceRouter.createCaller(createTestContext(owner));
      await expect(caller.deploy({ id: stack.id })).rejects.toThrow(/UNSET_IMAGE/);
      expect(queueAdd).not.toHaveBeenCalled();
      expect(await db.select().from(deployments)).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('defaults to keeping volumes', async () => {
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      await caller.delete({ id: stack.id });

      expect(removeStackMock).toHaveBeenCalledWith(expect.objectContaining({ removeVolumes: false }));
      expect(await db.select().from(services).where(eq(services.id, stack.id))).toHaveLength(0);
    });

    it('keeps the row when a volume could not be removed', async () => {
      // The service_volumes rows are the only record of which volumes are ours;
      // dropping them turns a retryable failure into an unattributable orphan.
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);
      removeStackMock.mockResolvedValueOnce({
        removedVolumes: [],
        failedVolumes: [{ name: 'ns_pgdata', reason: 'volume is in use' }],
        sweptContainers: [],
      } as any);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      await expect(caller.delete({ id: stack.id, removeVolumes: true })).rejects.toThrow(/volume is in use/);
      expect(await db.select().from(services).where(eq(services.id, stack.id))).toHaveLength(1);
    });
  });

  describe('logs', () => {
    it('passes a known compose service name through', async () => {
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);
      await db.insert(serviceContainers).values([
        { serviceId: stack.id, composeServiceName: 'web', status: 'running' },
      ] as any);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      const result = await caller.logs({ id: stack.id, composeServiceName: 'web', tail: 50 });

      expect(result.logs).toEqual(['line one', 'line two']);
      expect(getStackLogsMock).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: stack.id, composeServiceName: 'web', tail: 50 }),
      );
    });

    it('refuses a compose service name that is not part of this stack', async () => {
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      await expect(caller.logs({ id: stack.id, composeServiceName: 'someone-elses', tail: 50 })).rejects.toThrow(
        'is not a service in this stack',
      );
      expect(getStackLogsMock).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('validates a replacement Compose file before storing it', async () => {
      const { owner, project } = await twoTenants();
      const stack = await seedStack(project.id);

      const caller = serviceRouter.createCaller(createTestContext(owner));
      await expect(
        caller.update({ id: stack.id, composeFile: 'services:\n  a:\n    image: nginx\n    privileged: true\n' }),
      ).rejects.toThrow(/privileged/);

      const [row] = await db.select().from(services).where(eq(services.id, stack.id));
      expect(row.composeFile).toBe(VALID_STACK);
    });
  });
});
