/**
 * executeCleanup with a fake Docker client and fake reports. Never touches a
 * real daemon.
 */
import { executeCleanup, type CleanupDocker } from '../../src/services/disk-report/execute';
import { DEFAULT_POLICY, type DiskReport } from '../../src/services/disk-report/policy';

type Candidate = DiskReport['imageCandidates'][number];

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    tags: [`gs-app-${id}:old`],
    category: 'expired-build',
    confidence: 'safe',
    sizeBytes: 1000,
    exclusiveBytes: 800,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function report(imageCandidates: Candidate[]): DiskReport {
  return {
    mode: 'report',
    deletesPerformed: 0,
    generatedAt: new Date().toISOString(),
    policy: DEFAULT_POLICY,
    filesystem: null,
    summary: {
      imageCandidates: imageCandidates.length,
      imageBytesUpTo: 0,
      imageBytesAtLeast: 0,
      buildCacheTotalBytes: 0,
      buildCacheReclaimableBytes: 0,
      stoppedContainers: 0,
      volumesToReview: 0,
    },
    imageCandidates,
    protectedImages: [],
    stoppedContainers: [],
    volumesToReview: [{ name: 'customer-data', managed: true }],
    warnings: [],
    notes: [],
  };
}

/** A Docker client that fails the test on any call other than the two cleanup may make. */
function fakeDocker(removeImpl: (id: string) => Promise<unknown> = async () => ({})) {
  const removed: Array<{ id: string; options: unknown }> = [];
  const pruneBuilder = jest.fn().mockResolvedValue({ SpaceReclaimed: 4096 });
  const allowed: CleanupDocker = {
    getImage: (id: string) => ({
      remove: (options) => {
        removed.push({ id, options });
        return removeImpl(id);
      },
    }),
    pruneBuilder,
  };
  const docker = new Proxy(allowed, {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      throw new Error(`cleanup must not call docker.${String(prop)}`);
    },
  });
  return { docker, removed, pruneBuilder };
}

describe('executeCleanup', () => {
  it('is a dry run unless dryRun is explicitly false', async () => {
    const { docker, removed, pruneBuilder } = fakeDocker();
    const result = await executeCleanup(
      { imageIds: ['sha256:a'], includeBuildCache: true },
      { docker, buildReport: async () => report([candidate('sha256:a')]) },
    );
    expect(result.dryRun).toBe(true);
    expect(result.images.map((i) => i.id)).toEqual(['sha256:a']);
    expect(result.buildCache).toEqual({ idleForHours: DEFAULT_POLICY.buildCacheIdleDays * 24, bytesReclaimed: null });
    expect(removed).toEqual([]);
    expect(pruneBuilder).not.toHaveBeenCalled();
  });

  it('removes only images that are still safe candidates in a fresh plan, without force', async () => {
    const { docker, removed } = fakeDocker();
    const result = await executeCleanup(
      { imageIds: ['sha256:a', 'sha256:now-in-use', 'sha256:third-party', 'sha256:a'], dryRun: false },
      {
        docker,
        buildReport: async () =>
          report([candidate('sha256:a'), candidate('sha256:third-party', { confidence: 'review', tags: ['nginx:1.25'] })]),
      },
    );
    expect(removed).toEqual([{ id: 'sha256:a', options: { force: false, noprune: false } }]);
    expect(result.images.map((i) => i.id)).toEqual(['sha256:a']);
    expect(result.skipped).toEqual([
      { id: 'sha256:now-in-use', reason: expect.stringContaining('no longer a cleanup candidate') },
      { id: 'sha256:third-party', reason: expect.stringContaining('third-party') },
    ]);
    expect(result.volumesRemoved).toBe(0);
  });

  it('records a refused removal and carries on with the rest', async () => {
    const { docker, removed } = fakeDocker(async (id) => {
      if (id === 'sha256:busy') throw new Error('(HTTP code 409) conflict - image is being used by running container');
      return {};
    });
    const result = await executeCleanup(
      { imageIds: ['sha256:busy', 'sha256:b'], dryRun: false },
      { docker, buildReport: async () => report([candidate('sha256:busy'), candidate('sha256:b')]) },
    );
    expect(removed.map((r) => r.id)).toEqual(['sha256:busy', 'sha256:b']);
    expect(result.failed).toEqual([{ id: 'sha256:busy', error: expect.stringContaining('409') }]);
    expect(result.images.map((i) => i.id)).toEqual(['sha256:b']);
  });

  it('prunes only build cache idle past the policy window', async () => {
    const { docker, pruneBuilder } = fakeDocker();
    const result = await executeCleanup(
      { imageIds: [], includeBuildCache: true, dryRun: false, policy: { buildCacheIdleDays: 3 } },
      { docker, buildReport: async (policy) => ({ ...report([]), policy: { ...DEFAULT_POLICY, ...policy } }) },
    );
    expect(pruneBuilder).toHaveBeenCalledWith({ filters: { until: ['72h'] } });
    expect(result.buildCache).toEqual({ idleForHours: 72, bytesReclaimed: 4096 });
  });

  it('checks the request against a plan built with the requested policy', async () => {
    const { docker } = fakeDocker();
    const buildReport = jest.fn().mockResolvedValue(report([]));
    await executeCleanup({ imageIds: ['sha256:a'], policy: { rollbackKeepPerApp: 10 } }, { docker, buildReport });
    expect(buildReport).toHaveBeenCalledWith({ rollbackKeepPerApp: 10 });
  });
});
