/**
 * Which Docker an application's actions reach: its provider (a remote Docker
 * host or Proxmox) when it has one and is not explicitly local, otherwise the
 * control plane's own daemon. Nothing here connects anywhere.
 */
jest.mock('../../src/queues/setup', () => {
  throw new Error('queues/setup must not load in application router tests');
});
const mockProxy = () => new Proxy({ __esModule: true } as any, { get: (t, k) => (k in t ? t[k] : (t[k] = jest.fn())) });
jest.mock('../../src/queues/deployment', () => mockProxy());
jest.mock('../../src/services/github', () => mockProxy());
jest.mock('../../src/services/git-provider', () => mockProxy());
jest.mock('../../src/services/oauth-tokens', () => mockProxy());
jest.mock('../../src/services/container-manager', () => ({
  healthCheck: jest.fn().mockResolvedValue({ status: 'running', healthy: true }),
}));
jest.mock('../../src/services/docker', () => ({
  restartContainer: jest.fn().mockResolvedValue(true),
  getContainerLogs: jest.fn().mockResolvedValue(['2026-09-11T05:00:00Z local line']),
  getContainerStats: jest.fn().mockResolvedValue(null),
  getAppContainerInfo: jest.fn().mockResolvedValue(null),
  removeExistingContainers: jest.fn().mockResolvedValue(undefined),
  stopContainer: jest.fn().mockResolvedValue(true),
  searchDockerHubImages: jest.fn(),
  listDockerHubTags: jest.fn(),
}));
const mockProvider = {
  restart: jest.fn().mockResolvedValue(true),
  stop: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  getLogs: jest.fn().mockResolvedValue(['2026-09-11T05:00:00Z remote line']),
  getMetrics: jest.fn().mockResolvedValue({ cpuPercent: 12, memoryUsageMb: 100, memoryLimitMb: 512, memoryPercent: 19.5, networkRxBytes: 1, networkTxBytes: 2 }),
  getInfo: jest.fn().mockResolvedValue({ containerId: 'c1', containerName: 'gs-shop', status: 'running', ports: [], image: 'nginx', created: new Date() }),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true, status: 'running', checkedAt: new Date() }),
};
jest.mock('../../src/providers/factory', () => ({ getProvider: jest.fn(async () => mockProvider) }));

import { db, users, organizations, members, projects, applications, computeProviders } from '@guildserver/database';
import { applicationRouter } from '../../src/routers/application';
import * as dockerService from '../../src/services/docker';
import * as factory from '../../src/providers/factory';

const svc = dockerService as jest.Mocked<typeof dockerService>;
const getProvider = factory.getProvider as jest.Mock;
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

function ctx(user: { id: string; email: string; name: string | null }) {
  return { db, req: {} as any, res: {} as any, user: { ...user, role: 'user' }, isAuthenticated: true, isAdmin: false } as any;
}

async function world() {
  const s = stamp();
  const [owner] = await db.insert(users).values({ email: `ar-${s}@example.com`, name: 'owner' } as any).returning();
  const [org] = await db.insert(organizations).values({ name: `ar ${s}`, slug: `ar-${s}`, ownerId: owner.id } as any).returning();
  await db.insert(members).values({ userId: owner.id, organizationId: org.id, role: 'owner' } as any);
  const [project] = await db.insert(projects).values({ name: 'p', organizationId: org.id } as any).returning();
  const [provider] = await db.insert(computeProviders).values({ name: `edge ${s}`, type: 'docker-remote', config: {}, organizationId: org.id } as any).returning();
  const app = async (over: Record<string, unknown>) =>
    (await db.insert(applications).values({ name: `app-${stamp()}`, appName: 'shop', projectId: project.id, ...over } as any).returning())[0];
  return {
    caller: applicationRouter.createCaller(ctx(owner)),
    remote: await app({ deploymentTarget: 'docker-remote', providerId: provider.id }),
    local: await app({ deploymentTarget: 'docker-local', providerId: null }),
    localWithProvider: await app({ deploymentTarget: 'docker-local', providerId: provider.id }),
    providerId: provider.id,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('an application on a remote Docker host', () => {
  it('restarts, stops, reads logs and metrics, and is deleted through its provider', async () => {
    const w = await world();

    await w.caller.restart({ id: w.remote.id });
    await w.caller.stop({ id: w.remote.id });
    const logs = await w.caller.getLogs({ id: w.remote.id, lines: 25 });
    const metrics = await w.caller.getMetrics({ id: w.remote.id });
    await w.caller.delete({ id: w.remote.id });

    expect(getProvider).toHaveBeenCalledWith(w.providerId);
    expect(mockProvider.restart).toHaveBeenCalledWith(w.remote.id);
    expect(mockProvider.stop).toHaveBeenCalledWith(w.remote.id);
    expect(mockProvider.getLogs).toHaveBeenCalledWith(w.remote.id, 25);
    expect(mockProvider.remove).toHaveBeenCalledWith(w.remote.id);
    expect(logs[0].message).toBe('remote line');
    expect(metrics).toMatchObject({ status: 'running', cpu: { current: 12 }, memory: { current: 100, max: 512 } });

    for (const local of [svc.restartContainer, svc.stopContainer, svc.getContainerLogs, svc.getContainerStats, svc.removeExistingContainers]) {
      expect(local).not.toHaveBeenCalled();
    }
  });
});

describe('an application on this server', () => {
  it('uses the local daemon', async () => {
    const w = await world();
    await w.caller.restart({ id: w.local.id });
    await w.caller.stop({ id: w.local.id });
    const logs = await w.caller.getLogs({ id: w.local.id, lines: 10 });
    await w.caller.delete({ id: w.local.id });

    expect(svc.restartContainer).toHaveBeenCalledWith(w.local.id);
    expect(svc.stopContainer).toHaveBeenCalledWith(w.local.id);
    expect(svc.getContainerLogs).toHaveBeenCalledWith(w.local.id, 10);
    expect(svc.removeExistingContainers).toHaveBeenCalledWith(w.local.id);
    expect(logs[0].message).toBe('local line');
    expect(getProvider).not.toHaveBeenCalled();
  });

  it('stays local when explicitly targeted at this server, even with a provider set', async () => {
    const w = await world();
    await w.caller.getLogs({ id: w.localWithProvider.id, lines: 5 });
    expect(svc.getContainerLogs).toHaveBeenCalledWith(w.localWithProvider.id, 5);
    expect(getProvider).not.toHaveBeenCalled();
  });
});
