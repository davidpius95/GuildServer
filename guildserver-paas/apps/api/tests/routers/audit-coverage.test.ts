/**
 * The actions an auditor asks about leave a record: who deleted it, who
 * deployed it, who minted or revoked a credential. Nothing here connects
 * anywhere.
 */
jest.mock('../../src/queues/setup', () => {
  throw new Error('queues/setup must not load in audit coverage tests');
});
const mockProxy = () => new Proxy({ __esModule: true } as any, { get: (t, k) => (k in t ? t[k] : (t[k] = jest.fn())) });
jest.mock('../../src/queues/deployment', () => ({
  deploymentQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) },
}));
jest.mock('../../src/services/github', () => mockProxy());
jest.mock('../../src/services/git-provider', () => mockProxy());
jest.mock('../../src/services/oauth-tokens', () => mockProxy());
jest.mock('../../src/services/traefik-dynamic', () => mockProxy());
jest.mock('../../src/queues/backups', () => ({
  syncBackupSchedule: jest.fn().mockResolvedValue(undefined),
  addBackupJob: jest.fn().mockResolvedValue(undefined),
  addRestoreJob: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/container-manager', () => ({
  healthCheck: jest.fn().mockResolvedValue({ status: 'running', healthy: true }),
}));
jest.mock('../../src/services/docker', () => ({
  removeExistingContainers: jest.fn().mockResolvedValue(undefined),
  restartContainer: jest.fn().mockResolvedValue(true),
  stopContainer: jest.fn().mockResolvedValue(true),
  getContainerLogs: jest.fn().mockResolvedValue([]),
  getContainerStats: jest.fn().mockResolvedValue(null),
  getAppContainerInfo: jest.fn().mockResolvedValue(null),
  searchDockerHubImages: jest.fn(),
  listDockerHubTags: jest.fn(),
}));
jest.mock('../../src/services/docker/container', () => ({
  removeExistingContainers: jest.fn().mockResolvedValue(undefined),
  restartContainer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/database-provision', () => ({
  provisionDatabaseContainer: jest.fn().mockResolvedValue(undefined),
  removeDatabaseVolume: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/providers/factory', () => ({ getProvider: jest.fn(async () => ({ remove: jest.fn().mockResolvedValue(undefined) })) }));

import { db, auditLogs } from '@guildserver/database';
import { eq } from 'drizzle-orm';
import { applicationRouter } from '../../src/routers/application';
import { projectRouter } from '../../src/routers/project';
import { databaseRouter } from '../../src/routers/database';
import { apiTokenRouter } from '../../src/routers/api-token';
import { makeUser, makeOrg, makeWorld, auditRowsFor } from '../rest/fixtures';

function ctx(user: { id: string; email: string; name: string | null }) {
  return { db, req: {} as any, res: {} as any, user: { ...user, role: 'user' }, isAuthenticated: true, isAdmin: false } as any;
}

async function scene(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const org = await makeOrg(owner, label);
  const world = await makeWorld(org.id, label);
  return { owner, org, ...world };
}

const rowFor = async (resourceId: string) => (await auditRowsFor(resourceId))[0];

describe('deleting things is recorded', () => {
  it('records who deleted an application, and from which project', async () => {
    const { owner, org, app, project } = await scene('adel');

    await applicationRouter.createCaller(ctx(owner)).delete({ id: app.id });

    const row = await rowFor(app.id);
    expect(row).toMatchObject({
      userId: owner.id,
      organizationId: org.id,
      action: 'application.deleted',
      resourceType: 'application',
      resourceName: app.name,
    });
    expect(row.metadata).toMatchObject({ via: 'dashboard', projectId: project.id });
  });

  it('records whether a deleted database took its data with it', async () => {
    const { owner, org, database } = await scene('ddel');

    await databaseRouter.createCaller(ctx(owner)).delete({ id: database.id, destroyData: true });

    const row = await rowFor(database.id);
    expect(row).toMatchObject({
      userId: owner.id,
      organizationId: org.id,
      action: 'database.deleted',
      resourceType: 'database',
      resourceName: database.name,
    });
    expect(row.metadata).toMatchObject({ destroyedData: true, type: 'postgresql' });
  });

  it('records a database deleted without destroying its volume as exactly that', async () => {
    const { owner, database } = await scene('dkeep');

    await databaseRouter.createCaller(ctx(owner)).delete({ id: database.id });

    expect((await rowFor(database.id)).metadata).toMatchObject({ destroyedData: false });
  });

  it('records who deleted a project', async () => {
    const { owner, org, project } = await scene('pdel');

    await projectRouter.createCaller(ctx(owner)).delete({ id: project.id });

    expect(await rowFor(project.id)).toMatchObject({
      userId: owner.id,
      organizationId: org.id,
      action: 'project.deleted',
      resourceName: project.name,
    });
  });
});

describe('deploying is recorded', () => {
  it('records who deployed what, and which deployment it became', async () => {
    const { owner, org, app } = await scene('dep');

    const deployment = await applicationRouter.createCaller(ctx(owner)).deploy({ id: app.id });

    const row = (await auditRowsFor(app.id)).find((r) => r.action === 'application.deployed');
    expect(row).toMatchObject({ userId: owner.id, organizationId: org.id, resourceName: app.name });
    expect(row!.metadata).toMatchObject({ deploymentId: deployment.id });
  });
});

describe('credential changes are recorded', () => {
  it('records an issued token by id and scope, and never the secret itself', async () => {
    const { owner, org } = await scene('tmint');

    const created = await apiTokenRouter.createCaller(ctx(owner)).create({
      organizationId: org.id,
      name: 'ci-deploy',
      scopes: ['deploy'],
    });

    const row = await rowFor(created.id);
    expect(row).toMatchObject({
      userId: owner.id,
      organizationId: org.id,
      action: 'api_token.created',
      resourceType: 'api_token',
      resourceName: 'ci-deploy',
    });
    expect(row.metadata).toMatchObject({ scopes: ['deploy'] });
    // The plaintext leaves the server once, to its creator -- not into a table.
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(JSON.stringify(row)).not.toMatch(/gs_pat_/);
  });

  it('records a revoked token', async () => {
    const { owner, org } = await scene('trev');
    const created = await apiTokenRouter.createCaller(ctx(owner)).create({
      organizationId: org.id,
      name: 'to-revoke',
      scopes: ['read'],
    });

    await apiTokenRouter.createCaller(ctx(owner)).revoke({ id: created.id });

    const row = (await auditRowsFor(created.id)).find((r) => r.action === 'api_token.revoked');
    expect(row).toMatchObject({ userId: owner.id, organizationId: org.id, resourceName: 'to-revoke' });
    expect(row!.metadata).toMatchObject({ revokedByCreator: true });
  });
});

describe('an audit failure never costs the action', () => {
  it('still deletes the application even if the audit row cannot be written', async () => {
    const { owner, app } = await scene('afail');
    const spy = jest.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('audit table unavailable');
    });

    await expect(applicationRouter.createCaller(ctx(owner)).delete({ id: app.id })).resolves.toMatchObject({ success: true });
    spy.mockRestore();

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, app.id));
    expect(row).toBeUndefined();
  });
});
