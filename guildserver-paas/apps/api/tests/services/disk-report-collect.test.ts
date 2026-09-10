/**
 * The collector translates Docker and database shapes into the report's
 * inventory. Docker shapes here are copied from a real `GET /system/df` and
 * `GET /containers/json` response on a live host.
 */
import { db, users, organizations, projects, applications, deployments } from '@guildserver/database';
import { collectDiskInventory, collectReferences } from '../../src/services/disk-report/collect';
import { buildDiskReport } from '../../src/services/disk-report';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function fakeDocker() {
  return {
    df: jest.fn().mockResolvedValue({
      LayersSize: 37270918949,
      Images: [
        { Id: 'sha256:7993f91f48ed', RepoTags: ['gs-daily-habit-tracker-app:beabc5c7'], Size: 170339351, SharedSize: 170339351, Containers: 1, Created: 1788768552 },
        { Id: 'sha256:dangling', RepoTags: null, Size: 5000, SharedSize: -1, Containers: -1, Created: 1700000000 },
      ],
      Volumes: [
        { Name: 'attached', Labels: null, UsageData: { RefCount: 1, Size: 0 } },
        { Name: 'no-usage-data', Labels: { 'gs.managed': 'true' } },
      ],
      BuildCache: [{ ID: 'x', Size: 985805, InUse: false, Shared: false, LastUsedAt: '2026-09-09T17:36:03.278981947Z' }],
    }),
    listContainers: jest.fn().mockResolvedValue([
      { Id: 'c1', Names: ['/gs-daily-habit-tracker-app-beabc5c7'], Image: 'gs-daily-habit-tracker-app:beabc5c7', ImageID: 'sha256:7993f91f48ed', State: 'running', Created: 1788768562, Labels: { 'gs.managed': 'true' } },
    ]),
  };
}

describe('collectDiskInventory', () => {
  it('maps real Docker shapes, treating missing or negative counts safely', async () => {
    const docker = fakeDocker();
    const inv = await collectDiskInventory({
      docker: docker as any,
      statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
      statfsPath: '/data',
    });

    expect(docker.listContainers).toHaveBeenCalledWith({ all: true });
    expect(inv.images[1]).toMatchObject({ repoTags: [], sharedBytes: 0, containers: 0 });
    expect(inv.volumes).toEqual([
      { name: 'attached', labels: {}, refCount: 1 },
      // Unknown usage must stay unknown rather than become "unused".
      { name: 'no-usage-data', labels: { 'gs.managed': 'true' }, refCount: -1 },
    ]);
    expect(inv.containers[0]).toMatchObject({ name: 'gs-daily-habit-tracker-app-beabc5c7', state: 'running' });
    expect(inv.filesystem).toEqual({ path: '/data', totalBytes: 4_096_000, availableBytes: 1_024_000 });
  });

  it('still produces an inventory when filesystem usage cannot be read', async () => {
    const inv = await collectDiskInventory({
      docker: fakeDocker() as any,
      statfs: async () => {
        throw new Error('EACCES');
      },
    });
    expect(inv.filesystem).toBeNull();
    expect(inv.images).toHaveLength(2);
  });

  it('only ever calls read-only Docker methods', async () => {
    // The fake exposes nothing but df and listContainers; any other call throws.
    const docker = new Proxy(fakeDocker(), {
      get(target: any, prop) {
        if (prop in target || typeof prop === 'symbol' || prop === 'then') return target[prop];
        throw new Error(`collector called a non-read-only Docker method: ${String(prop)}`);
      },
    });
    await expect(collectDiskInventory({ docker, statfs: async () => ({ bsize: 1, blocks: 1, bavail: 1 }) })).resolves.toBeDefined();
  });
});

describe('collectReferences', () => {
  async function fixture() {
    const s = stamp();
    const [user] = await db.insert(users).values({ email: `disk-${s}@example.com`, name: 'Disk' } as any).returning();
    const [org] = await db.insert(organizations).values({ name: `Disk ${s}`, slug: `disk-${s}`, ownerId: user.id } as any).returning();
    const [project] = await db.insert(projects).values({ name: 'P', organizationId: org.id } as any).returning();
    const [app] = await db
      .insert(applications)
      .values({ name: `disk-app-${s}`, appName: `disk-app-${s}`, projectId: project.id, dockerImage: 'mongo:7', dockerTag: 'latest' } as any)
      .returning();
    return { s, app };
  }

  it('returns only completed deployments that carry an image, since rollback accepts nothing else', async () => {
    const { s, app } = await fixture();
    await db.insert(deployments).values([
      { applicationId: app.id, title: 'ok', status: 'completed', imageTag: `gs-disk-${s}:ok` },
      { applicationId: app.id, title: 'failed', status: 'failed', imageTag: `gs-disk-${s}:failed` },
      { applicationId: app.id, title: 'unhealthy', status: 'unhealthy', imageTag: `gs-disk-${s}:unhealthy` },
      { applicationId: app.id, title: 'no image', status: 'completed', imageTag: null },
    ] as any);

    const refs = await collectReferences(db);
    const mine = refs.deployments.filter((d) => d.applicationId === app.id);
    expect(mine.map((d) => d.imageTag)).toEqual([`gs-disk-${s}:ok`]);
    expect(mine[0].createdAt).toBeInstanceOf(Date);
    expect(refs.configured.find((c) => c.applicationId === app.id)).toEqual({
      applicationId: app.id,
      dockerImage: 'mongo:7',
      dockerTag: 'latest',
    });
  });

  it('feeds an end-to-end report that protects the running and configured images', async () => {
    const { app } = await fixture();
    const report = await buildDiskReport({
      docker: fakeDocker() as any,
      database: db,
      statfs: async () => ({ bsize: 1, blocks: 100, bavail: 50 }),
    });
    expect(report.deletesPerformed).toBe(0);
    expect(report.protectedImages.map((p) => p.id)).toContain('sha256:7993f91f48ed');
    expect(report.imageCandidates.map((c) => c.id)).toEqual(['sha256:dangling']);
    expect(report.filesystem).toMatchObject({ usedPercent: 50, status: 'ok' });
    expect(app.id).toBeTruthy();
  });
});
