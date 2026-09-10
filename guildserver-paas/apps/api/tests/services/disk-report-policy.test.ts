/**
 * The retention rules behind the disk report.
 *
 * The one outcome that must never happen is recommending removal of an image a
 * rollback could need, or of anything holding customer data.
 */
import {
  DEFAULT_POLICY,
  configuredImageRef,
  normalizeImageRef,
  planCleanup,
  rollbackProtectedRefs,
  type DiskInventory,
  type ImageEntry,
  type ReferenceData,
} from '../../src/services/disk-report/policy';

const NOW = new Date('2026-09-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const unixDaysAgo = (n: number) => Math.floor(daysAgo(n).getTime() / 1000);

function image(id: string, tags: string[], overrides: Partial<ImageEntry> = {}): ImageEntry {
  return { id, repoTags: tags, sizeBytes: 100, sharedBytes: 0, containers: 0, created: unixDaysAgo(60), ...overrides };
}

function inventory(overrides: Partial<DiskInventory> = {}): DiskInventory {
  return { images: [], containers: [], volumes: [], buildCache: [], filesystem: null, ...overrides };
}

const noRefs: ReferenceData = { configured: [], deployments: [] };

const candidateIds = (r: ReturnType<typeof planCleanup>) => r.imageCandidates.map((c) => c.id);
const protectedIds = (r: ReturnType<typeof planCleanup>) => r.protectedImages.map((p) => p.id);

describe('normalizeImageRef', () => {
  it.each([
    ['nginx', 'nginx:latest'],
    ['nginx:1.27', 'nginx:1.27'],
    ['docker.io/library/nginx:1', 'nginx:1'],
    ['docker.io/crazymax/n8n:latest', 'crazymax/n8n:latest'],
    ['localhost:5000/app', 'localhost:5000/app:latest'],
    ['ghcr.io/org/app:v1', 'ghcr.io/org/app:v1'],
    ['redis@sha256:abc', 'redis@sha256:abc'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeImageRef(input)).toBe(expected);
  });
});

describe('configuredImageRef', () => {
  it('joins an untagged image with its tag', () => {
    expect(configuredImageRef('redis', '7')).toEqual({ ref: 'redis:7', conflicting: false });
  });

  it('defaults a missing tag to latest', () => {
    expect(configuredImageRef('nginx', null)).toEqual({ ref: 'nginx:latest', conflicting: false });
  });

  it('keeps an embedded tag and flags a conflicting separate tag', () => {
    // Seen in production: "mongo:7" + "latest" concatenates to "mongo:7:latest".
    expect(configuredImageRef('mongo:7', 'latest')).toEqual({ ref: 'mongo:7', conflicting: true });
  });

  it('does not flag an embedded tag that agrees with the separate one', () => {
    expect(configuredImageRef('nginx:latest', 'latest')).toEqual({ ref: 'nginx:latest', conflicting: false });
  });

  it('does not mistake a registry port for a tag', () => {
    expect(configuredImageRef('localhost:5000/app', 'v2')).toEqual({ ref: 'localhost:5000/app:v2', conflicting: false });
  });
});

describe('rollback protection', () => {
  const policy = { ...DEFAULT_POLICY, rollbackKeepPerApp: 2, rollbackRetentionDays: 14 };

  it('keeps the newest N completed deployments per application', () => {
    const refs = rollbackProtectedRefs(
      [
        { applicationId: 'a', imageTag: 'gs-a:1', createdAt: daysAgo(100) },
        { applicationId: 'a', imageTag: 'gs-a:2', createdAt: daysAgo(90) },
        { applicationId: 'a', imageTag: 'gs-a:3', createdAt: daysAgo(80) },
      ],
      policy,
      NOW,
    );
    expect([...refs].sort()).toEqual(['gs-a:2', 'gs-a:3']);
  });

  it('keeps anything inside the retention window even beyond N', () => {
    const refs = rollbackProtectedRefs(
      [1, 2, 3, 4].map((n) => ({ applicationId: 'a', imageTag: `gs-a:${n}`, createdAt: daysAgo(n) })),
      policy,
      NOW,
    );
    expect(refs.size).toBe(4);
  });

  it('gives each application its own allowance', () => {
    const deployments = [
      ...[1, 2, 3].map((n) => ({ applicationId: 'busy', imageTag: `gs-busy:${n}`, createdAt: daysAgo(100 + n) })),
      { applicationId: 'quiet', imageTag: 'gs-quiet:1', createdAt: daysAgo(200) },
    ];
    const refs = rollbackProtectedRefs(deployments, policy, NOW);
    // A busy app must not push a quiet app's only rollback target out.
    expect(refs.has('gs-quiet:1')).toBe(true);
    expect(refs.has('gs-busy:3')).toBe(false);
  });
});

describe('planCleanup', () => {
  it('never recommends an image a rollback could need', () => {
    const report = planCleanup(
      inventory({ images: [image('keep', ['gs-app:new']), image('old', ['gs-app:old'])] }),
      {
        configured: [],
        deployments: [
          { applicationId: 'app', imageTag: 'gs-app:new', createdAt: daysAgo(40) },
          ...[1, 2, 3, 4, 5].map((n) => ({ applicationId: 'app', imageTag: `gs-app:newer${n}`, createdAt: daysAgo(30 + n) })),
          { applicationId: 'app', imageTag: 'gs-app:old', createdAt: daysAgo(400) },
        ],
      },
      { rollbackKeepPerApp: 6 },
      NOW,
    );
    expect(protectedIds(report)).toContain('keep');
    expect(report.protectedImages.find((p) => p.id === 'keep')!.reasons).toContain('rollback');
    expect(candidateIds(report)).toEqual(['old']);
    expect(report.imageCandidates[0].category).toBe('expired-build');
  });

  it('matches references across Docker Hub spellings', () => {
    const report = planCleanup(
      inventory({ images: [image('redis', ['redis:7'])] }),
      { configured: [], deployments: [{ applicationId: 'a', imageTag: 'docker.io/library/redis:7', createdAt: daysAgo(1) }] },
      {},
      NOW,
    );
    expect(candidateIds(report)).toEqual([]);
  });

  it('protects images used by running or stopped containers', () => {
    const report = planCleanup(
      inventory({
        images: [image('running', ['old-thing:1']), image('stopped', ['other:2']), image('counted', ['third:3'], { containers: 1 })],
        containers: [
          { id: 'c1', name: 'c1', image: 'old-thing:1', imageId: 'running', state: 'running', created: unixDaysAgo(500), labels: {} },
          { id: 'c2', name: 'c2', image: 'other:2', imageId: 'stopped', state: 'exited', created: unixDaysAgo(500), labels: {} },
        ],
      }),
      noRefs,
      {},
      NOW,
    );
    expect(candidateIds(report)).toEqual([]);
    expect(report.protectedImages.every((p) => p.reasons.includes('in-use'))).toBe(true);
  });

  it("protects the image an application is configured to deploy, even with a doubled tag", () => {
    const report = planCleanup(
      inventory({ images: [image('mongo', ['mongo:7'])] }),
      { configured: [{ applicationId: 'a', dockerImage: 'mongo:7', dockerTag: 'latest' }], deployments: [] },
      {},
      NOW,
    );
    expect(report.protectedImages[0].reasons).toEqual(['configured']);
    expect(report.warnings.join(' ')).toMatch(/mongo:7:latest/);
  });

  it('classifies dangling, platform-built and third-party images with matching confidence', () => {
    const report = planCleanup(
      inventory({ images: [image('dangling', []), image('built', ['gs-x:abc']), image('pulled', ['postgres:12'])] }),
      noRefs,
      {},
      NOW,
    );
    const byId = Object.fromEntries(report.imageCandidates.map((c) => [c.id, c]));
    expect(byId.dangling).toMatchObject({ category: 'dangling-image', confidence: 'safe' });
    expect(byId.built).toMatchObject({ category: 'expired-build', confidence: 'safe' });
    // Something a customer pulled could be re-pulled, but is not ours to call.
    expect(byId.pulled).toMatchObject({ category: 'unused-image', confidence: 'review' });
  });

  it('treats the literal <none>:<none> tag as dangling', () => {
    const report = planCleanup(inventory({ images: [image('none', ['<none>:<none>'])] }), noRefs, {}, NOW);
    expect(report.imageCandidates[0].category).toBe('dangling-image');
  });

  it('reports image bytes as a range because shared layers may survive', () => {
    const report = planCleanup(
      inventory({ images: [image('a', ['gs-a:1'], { sizeBytes: 1000, sharedBytes: 900 }), image('b', ['gs-b:1'], { sizeBytes: 500, sharedBytes: 0 })] }),
      noRefs,
      {},
      NOW,
    );
    expect(report.summary.imageBytesUpTo).toBe(1500);
    expect(report.summary.imageBytesAtLeast).toBe(600);
  });

  it('never lists a volume as a cleanup candidate, only for review', () => {
    const report = planCleanup(
      inventory({
        volumes: [
          { name: 'orphan', labels: {}, refCount: 0 },
          { name: 'gs-app-data', labels: { 'gs.managed': 'true' }, refCount: 0 },
          { name: 'attached', labels: {}, refCount: 1 },
          { name: 'unknown', labels: {}, refCount: -1 },
        ],
      }),
      noRefs,
      {},
      NOW,
    );
    expect(report.volumesToReview).toEqual([
      { name: 'orphan', managed: false },
      { name: 'gs-app-data', managed: true },
    ]);
    // Candidates are images only; nothing volume-shaped can reach them.
    expect(JSON.stringify(report.imageCandidates)).not.toMatch(/orphan|gs-app-data/);
  });

  it('counts only idle, unused build cache as reclaimable', () => {
    const report = planCleanup(
      inventory({
        buildCache: [
          { sizeBytes: 10, inUse: true, shared: false, lastUsedAt: daysAgo(100).toISOString() },
          { sizeBytes: 20, inUse: false, shared: false, lastUsedAt: daysAgo(1).toISOString() },
          { sizeBytes: 40, inUse: false, shared: false, lastUsedAt: daysAgo(30).toISOString() },
          { sizeBytes: 80, inUse: false, shared: false, lastUsedAt: null },
        ],
      }),
      noRefs,
      {},
      NOW,
    );
    expect(report.summary.buildCacheTotalBytes).toBe(150);
    expect(report.summary.buildCacheReclaimableBytes).toBe(120);
  });

  it('lists only old, stopped, platform-managed containers', () => {
    const base = { image: 'x:1', imageId: 'i' };
    const report = planCleanup(
      inventory({
        containers: [
          { ...base, id: '1', name: 'old-stopped', state: 'exited', created: unixDaysAgo(60), labels: { 'gs.managed': 'true' } },
          { ...base, id: '2', name: 'new-stopped', state: 'exited', created: unixDaysAgo(2), labels: { 'gs.managed': 'true' } },
          { ...base, id: '3', name: 'old-running', state: 'running', created: unixDaysAgo(60), labels: { 'gs.managed': 'true' } },
          { ...base, id: '4', name: 'not-ours', state: 'exited', created: unixDaysAgo(60), labels: {} },
        ],
      }),
      noRefs,
      {},
      NOW,
    );
    expect(report.stoppedContainers.map((c) => c.name)).toEqual(['old-stopped']);
  });

  it.each([
    [79.9, 'ok'],
    [80, 'warning'],
    [89.9, 'warning'],
    [90, 'critical'],
  ])('reports %s%% used as %s', (percent, status) => {
    const total = 1_000_000;
    const report = planCleanup(
      inventory({ filesystem: { path: '/', totalBytes: total, availableBytes: Math.round(total * (1 - Number(percent) / 100)) } }),
      noRefs,
      {},
      NOW,
    );
    expect(report.filesystem!.status).toBe(status);
  });

  it('reports no filesystem status when usage could not be read', () => {
    expect(planCleanup(inventory(), noRefs, {}, NOW).filesystem).toBeNull();
  });

  it('declares itself a report that deleted nothing, with totals that match its lists', () => {
    const report = planCleanup(
      inventory({ images: [image('a', ['gs-a:1']), image('b', [])], volumes: [{ name: 'v', labels: {}, refCount: 0 }] }),
      noRefs,
      {},
      NOW,
    );
    expect(report.mode).toBe('report');
    expect(report.deletesPerformed).toBe(0);
    expect(report.notes[0]).toMatch(/nothing was deleted/i);
    expect(report.summary.imageCandidates).toBe(report.imageCandidates.length);
    expect(report.summary.volumesToReview).toBe(report.volumesToReview.length);
  });
});
