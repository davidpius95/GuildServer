/**
 * A token must never reach outside its organization or project restriction —
 * including when its user can legitimately see the other organization in the
 * dashboard, because tRPC authorizes the USER across all their organizations.
 */
jest.mock('../../src/queues/setup', () => {
  throw new Error('queues/setup must not load in REST tests: it opens Redis and starts BullMQ workers');
});
const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
jest.mock('../../src/queues/deployment', () => ({ deploymentQueue: { add: (...args: any[]) => mockQueueAdd(...args) } }));
const mockProxy = () => new Proxy({ __esModule: true } as any, { get: (t, k) => (k in t ? t[k] : (t[k] = jest.fn())) });
jest.mock('../../src/queues/backups', () => mockProxy());
jest.mock('../../src/queues/instances', () => mockProxy());
jest.mock('../../src/queues/crypto-payments', () => mockProxy());
jest.mock('../../src/services/db-backup', () => mockProxy());
jest.mock('../../src/services/database-provision', () => mockProxy());
jest.mock('../../src/services/compose/deploy', () => mockProxy());
jest.mock('../../src/providers/factory', () => mockProxy());
jest.mock('../../src/websocket/server', () => mockProxy());
// Every Docker call REST can reach is replaced: this host runs live customer containers.
jest.mock('../../src/services/docker', () => ({
  ...jest.requireActual('../../src/services/docker'),
  restartContainer: jest.fn().mockResolvedValue(true),
  stopContainer: jest.fn().mockResolvedValue(true),
  getContainerLogs: jest.fn().mockResolvedValue(['line']),
  getContainerStats: jest.fn().mockResolvedValue(null),
  getAppContainerInfo: jest.fn().mockResolvedValue(null),
  removeExistingContainers: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import { addMember, auditRowsFor, deploymentCountFor, makeOrg, makeUser, makeWorld, token } from './fixtures';
import { restApp } from './app';
import { resetRateLimits } from '../../src/rest/v1/rate-limit';

const app = restApp();

async function twoOrgs() {
  const owner = await makeUser('iso');
  const orgA = await makeOrg(owner, 'orga');
  const orgB = await makeOrg(owner, 'orgb'); // the same user owns B too
  const a = await makeWorld(orgA.id, 'a');
  const a2 = await makeWorld(orgA.id, 'a2');
  const b = await makeWorld(orgB.id, 'b');
  const { token: tokenA } = await token(orgA.id, owner.id, ['admin']);
  return { owner, orgA, orgB, a, a2, b, tokenA };
}

const get = (path: string, t: string) => request(app).get(path).set('Authorization', `Bearer ${t}`);
const post = (path: string, t: string) => request(app).post(path).set('Authorization', `Bearer ${t}`);

beforeEach(() => {
  resetRateLimits();
  mockQueueAdd.mockClear();
});

describe('cross-organization access is 404, even for a user in both organizations', () => {
  it("cannot read organization B's resources with a token for A", async () => {
    const { b, tokenA } = await twoOrgs();
    for (const path of [
      `/api/v1/applications/${b.app.id}`,
      `/api/v1/applications/${b.app.id}/deployments`,
      `/api/v1/applications/${b.app.id}/logs`,
      `/api/v1/deployments/${b.deployment.id}`,
      `/api/v1/databases/${b.database.id}`,
      `/api/v1/services/${b.service.id}`,
      `/api/v1/domains?applicationId=${b.app.id}`,
      `/api/v1/applications?projectId=${b.project.id}`,
    ]) {
      const res = await get(path, tokenA);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    }
  });

  it("cannot act on organization B's resources, and leaves no trace there", async () => {
    const { b, tokenA } = await twoOrgs();
    const before = await deploymentCountFor(b.app.id);

    for (const path of [
      `/api/v1/applications/${b.app.id}/deployments`,
      `/api/v1/applications/${b.app.id}/restart`,
      `/api/v1/applications/${b.app.id}/stop`,
      `/api/v1/services/${b.service.id}/deployments`,
    ]) {
      const res = await post(path, tokenA);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }

    expect(await deploymentCountFor(b.app.id)).toBe(before);
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(await auditRowsFor(b.app.id)).toHaveLength(0);
    expect(await auditRowsFor(b.service.id)).toHaveLength(0);
  });

  it("never lists organization B's items, although the user can see them in the dashboard", async () => {
    const { a, b, tokenA } = await twoOrgs();
    const cases: Array<[string, string, string]> = [
      ['/api/v1/projects', a.project.id, b.project.id],
      ['/api/v1/applications', a.app.id, b.app.id],
      ['/api/v1/databases', a.database.id, b.database.id],
      ['/api/v1/services', a.service.id, b.service.id],
    ];
    for (const [path, mine, theirs] of cases) {
      const res = await get(path, tokenA);
      expect(res.status).toBe(200);
      const ids = (res.body.data as any[]).map((x) => x.id);
      expect({ path, hasMine: ids.includes(mine), hasTheirs: ids.includes(theirs) }).toEqual({ path, hasMine: true, hasTheirs: false });
    }
  });
});

describe('project restriction', () => {
  it('confines a token to its projects: other projects in the same organization are 404 and unlisted', async () => {
    const { owner, orgA, a, a2 } = await twoOrgs();
    const { token: narrow } = await token(orgA.id, owner.id, ['admin'], { projectIds: [a.project.id] });

    expect((await get(`/api/v1/applications/${a.app.id}`, narrow)).status).toBe(200);
    expect((await get(`/api/v1/applications/${a2.app.id}`, narrow)).status).toBe(404);
    expect((await get(`/api/v1/databases/${a2.database.id}`, narrow)).status).toBe(404);
    expect((await get(`/api/v1/services/${a2.service.id}`, narrow)).status).toBe(404);
    expect((await get(`/api/v1/applications?projectId=${a2.project.id}`, narrow)).status).toBe(404);
    expect((await post(`/api/v1/applications/${a2.app.id}/deployments`, narrow)).status).toBe(404);

    for (const path of ['/api/v1/projects', '/api/v1/applications', '/api/v1/databases', '/api/v1/services']) {
      const ids = ((await get(path, narrow)).body.data as any[]).map((x) => x.id);
      expect(ids).not.toEqual(expect.arrayContaining([a2.project.id]));
      expect(ids).not.toContain(a2.app.id);
      expect(ids).not.toContain(a2.database.id);
      expect(ids).not.toContain(a2.service.id);
    }
  });
});

describe('ids that name nothing', () => {
  it('answers 404 for a nonexistent or malformed id, never 500', async () => {
    const { tokenA } = await twoOrgs();
    for (const path of [
      '/api/v1/applications/00000000-0000-0000-0000-000000000000',
      '/api/v1/applications/not-a-uuid',
      "/api/v1/deployments/'; drop table users; --",
      '/api/v1/domains?applicationId=nope',
    ]) {
      expect({ path, status: (await get(path, tokenA)).status }).toEqual({ path, status: 404 });
    }
  });

  it('does not confirm whether another member of B exists by varying its answer', async () => {
    const { b, tokenA } = await twoOrgs();
    const missing = await get('/api/v1/applications/00000000-0000-0000-0000-000000000000', tokenA);
    const foreign = await get(`/api/v1/applications/${b.app.id}`, tokenA);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });

  it('a stranger to organization B is equally refused', async () => {
    const { b } = await twoOrgs();
    const outsider = await makeUser('outsider');
    const own = await makeOrg(outsider, 'own');
    const { token: t } = await token(own.id, outsider.id, ['admin']);
    expect((await get(`/api/v1/applications/${b.app.id}`, t)).status).toBe(404);
    await addMember(outsider.id, own.id, 'member').catch(() => undefined);
  });
});
