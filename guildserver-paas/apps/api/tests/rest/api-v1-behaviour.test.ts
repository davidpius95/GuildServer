/**
 * Authentication, scopes, actions, redaction, limits and error hygiene for /api/v1.
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
const mockRestart = jest.fn().mockResolvedValue(true);
const mockStop = jest.fn().mockResolvedValue(true);
const mockLogs = jest.fn().mockResolvedValue(['line one', 'line two']);
jest.mock('../../src/services/docker', () => ({
  ...jest.requireActual('../../src/services/docker'),
  restartContainer: (...a: any[]) => mockRestart(...a),
  stopContainer: (...a: any[]) => mockStop(...a),
  getContainerLogs: (...a: any[]) => mockLogs(...a),
  getContainerStats: jest.fn().mockResolvedValue(null),
  getAppContainerInfo: jest.fn().mockResolvedValue(null),
  removeExistingContainers: jest.fn().mockResolvedValue(undefined),
}));

import jwt from 'jsonwebtoken';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db, apiTokens, users } from '@guildserver/database';
import { revokeApiToken } from '../../src/services/api-tokens';
import { resetRateLimits } from '../../src/rest/v1/rate-limit';
import { DB_PASSWORD, addMember, auditRowsFor, deploymentCountFor, makeOrg, makeUser, makeWorld, removeMember, token } from './fixtures';
import { restApp } from './app';
import * as access from '../../src/rest/v1/access';

const app = restApp();
const as = (t: string) => ({ get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${t}`), post: (p: string) => request(app).post(p).set('Authorization', `Bearer ${t}`) });

async function setup() {
  const owner = await makeUser('beh');
  const org = await makeOrg(owner, 'beh');
  const world = await makeWorld(org.id, 'w');
  return { owner, org, world };
}

const originalLimit = process.env.GS_API_RATE_LIMIT_PER_MINUTE;
beforeEach(() => {
  resetRateLimits();
  mockQueueAdd.mockClear();
  mockRestart.mockClear();
  mockStop.mockClear();
  mockLogs.mockReset().mockResolvedValue(['line one', 'line two']);
  if (originalLimit === undefined) delete process.env.GS_API_RATE_LIMIT_PER_MINUTE;
  else process.env.GS_API_RATE_LIMIT_PER_MINUTE = originalLimit;
});

describe('authentication', () => {
  const unauthorized = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };

  it('rejects every credential that is not a live token for a current member', async () => {
    const { owner, org } = await setup();
    const dev = await makeUser('dev');
    await addMember(dev.id, org.id, 'member');
    const { token: revoked, record } = await token(org.id, owner.id, ['read']);
    await revokeApiToken(record.id);
    const { token: expired } = await token(org.id, owner.id, ['read'], { expiresAt: new Date(Date.now() - 1000) });
    const { token: leaver } = await token(org.id, dev.id, ['read']);
    await removeMember(dev.id, org.id);
    const ghost = await makeUser('ghost');
    await addMember(ghost.id, org.id, 'member');
    const { token: deletedUser } = await token(org.id, ghost.id, ['read']);
    await db.delete(users).where(eq(users.id, ghost.id));
    const sessionJwt = jwt.sign({ userId: owner.id, email: owner.email }, process.env.JWT_SECRET!);

    const cases: Array<[string, (r: request.Test) => request.Test]> = [
      ['no header', (r) => r],
      ['empty bearer', (r) => r.set('Authorization', 'Bearer ')],
      ['dashboard JWT', (r) => r.set('Authorization', `Bearer ${sessionJwt}`)],
      ['wrong prefix', (r) => r.set('Authorization', `Bearer ghp_${'a'.repeat(36)}`)],
      ['unknown token', (r) => r.set('Authorization', `Bearer gs_pat_${'A'.repeat(43)}`)],
      ['revoked', (r) => r.set('Authorization', `Bearer ${revoked}`)],
      ['expired', (r) => r.set('Authorization', `Bearer ${expired}`)],
      ['user left the organization', (r) => r.set('Authorization', `Bearer ${leaver}`)],
      ['user deleted', (r) => r.set('Authorization', `Bearer ${deletedUser}`)],
    ];
    for (const [label, apply] of cases) {
      const res = await apply(request(app).get('/api/v1/me'));
      expect({ label, status: res.status, body: res.body }).toEqual({ label, status: 401, body: unauthorized });
    }
  });

  it('describes the token on /me', async () => {
    const { owner, org } = await setup();
    const { token: t, record } = await token(org.id, owner.id, ['deploy']);
    const res = await as(t).get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { tokenId: record.id, organizationId: org.id, userId: owner.id, scopes: ['deploy'], projectIds: null } });
  });
});

describe('scopes', () => {
  it('refuses deploy actions without the deploy scope, naming it', async () => {
    const { owner, org, world } = await setup();
    for (const scopes of [['read'], ['write']]) {
      const { token: t } = await token(org.id, owner.id, scopes);
      for (const path of [
        `/api/v1/applications/${world.app.id}/deployments`,
        `/api/v1/applications/${world.app.id}/restart`,
        `/api/v1/applications/${world.app.id}/stop`,
        `/api/v1/services/${world.service.id}/deployments`,
      ]) {
        const res = await as(t).post(path);
        expect({ scopes, path, status: res.status }).toEqual({ scopes, path, status: 403 });
        expect(res.body.error.message).toContain('"deploy"');
      }
    }
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockRestart).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('lets any valid token read, since write and deploy both imply read', async () => {
    const { owner, org, world } = await setup();
    for (const scopes of [['read'], ['deploy'], ['write'], ['admin']]) {
      const { token: t } = await token(org.id, owner.id, scopes);
      expect({ scopes, status: (await as(t).get(`/api/v1/applications/${world.app.id}`)).status }).toEqual({ scopes, status: 200 });
    }
  });
});

describe('actions', () => {
  it('queues a deploy, returns 202, and audits it with the token id', async () => {
    const { owner, org, world } = await setup();
    const { token: t, record } = await token(org.id, owner.id, ['deploy']);
    const before = await deploymentCountFor(world.app.id);

    const res = await as(t).post(`/api/v1/applications/${world.app.id}/deployments`).send({ gitCommitSha: 'abc123' });
    expect(res.status).toBe(202);
    expect(res.body.data.id).toBeTruthy();
    expect(await deploymentCountFor(world.app.id)).toBe(before + 1);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);

    const audit = await auditRowsFor(world.app.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'application.deploy', userId: owner.id, organizationId: org.id });
    expect((audit[0].metadata as any).tokenId).toBe(record.id);
  });

  it('restarts and stops through Docker (mocked), auditing each', async () => {
    const { owner, org, world } = await setup();
    const { token: t } = await token(org.id, owner.id, ['admin']);
    expect((await as(t).post(`/api/v1/applications/${world.app.id}/restart`)).status).toBe(200);
    expect((await as(t).post(`/api/v1/applications/${world.app.id}/stop`)).status).toBe(200);
    expect(mockRestart).toHaveBeenCalledWith(world.app.id);
    expect(mockStop).toHaveBeenCalledWith(world.app.id);
    expect((await auditRowsFor(world.app.id)).map((r) => r.action).sort()).toEqual(['application.restart', 'application.stop']);
  });

  it('passes tail through to logs and rejects an out-of-range tail', async () => {
    const { owner, org, world } = await setup();
    const { token: t } = await token(org.id, owner.id, ['read']);
    const res = await as(t).get(`/api/v1/applications/${world.app.id}/logs?tail=5`);
    expect(res.status).toBe(200);
    expect(mockLogs).toHaveBeenCalledWith(world.app.id, 5);
    const bad = await as(t).get(`/api/v1/applications/${world.app.id}/logs?tail=0`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
  });
});

describe('redaction', () => {
  it('never returns a database password or a token hash', async () => {
    const { owner, org, world } = await setup();
    const { token: t } = await token(org.id, owner.id, ['admin']);
    for (const path of [`/api/v1/databases/${world.database.id}`, '/api/v1/databases', '/api/v1/me', `/api/v1/applications/${world.app.id}`]) {
      const res = await as(t).get(path);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(DB_PASSWORD);
      expect(res.text).not.toMatch(/tokenHash/i);
      expect(res.text).not.toMatch(/:\/\/[^:\s"]+:[^@\s"[]+@/);
    }
    const single = await as(t).get(`/api/v1/databases/${world.database.id}`);
    expect(single.body.data.password).toBe('[redacted]');
  });
});

describe('rate limiting', () => {
  it('limits per token, with a numeric Retry-After, leaving other tokens alone', async () => {
    process.env.GS_API_RATE_LIMIT_PER_MINUTE = '3';
    const { owner, org } = await setup();
    const { token: busy } = await token(org.id, owner.id, ['read']);
    const { token: other } = await token(org.id, owner.id, ['read']);
    for (let i = 0; i < 3; i++) expect((await as(busy).get('/api/v1/me')).status).toBe(200);
    const limited = await as(busy).get('/api/v1/me');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await as(other).get('/api/v1/me')).status).toBe(200);
  });
});

describe('bookkeeping', () => {
  it('records first use and does not rewrite it on an immediate second request', async () => {
    const { owner, org } = await setup();
    const { token: t, record } = await token(org.id, owner.id, ['read']);
    await as(t).get('/api/v1/me');
    await new Promise((r) => setTimeout(r, 100));
    const [first] = await db.select().from(apiTokens).where(eq(apiTokens.id, record.id));
    expect(first.lastUsedAt).not.toBeNull();
    await as(t).get('/api/v1/me');
    await new Promise((r) => setTimeout(r, 100));
    const [second] = await db.select().from(apiTokens).where(eq(apiTokens.id, record.id));
    expect(second.lastUsedAt?.getTime()).toBe(first.lastUsedAt?.getTime());
  });
});

describe('error hygiene', () => {
  it('answers unknown endpoints with the error envelope', async () => {
    const { owner, org } = await setup();
    const { token: t } = await token(org.id, owner.id, ['read']);
    const res = await as(t).get('/api/v1/no-such-thing');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('does not leak internal detail when fetching logs fails', async () => {
    // getLogs catches its own failures and used to echo error.message back.
    const { owner, org, world } = await setup();
    const { token: t } = await token(org.id, owner.id, ['read']);
    mockLogs.mockRejectedValue(new Error('connect ECONNREFUSED /var/run/docker.sock at internalFn (/srv/app/x.ts:12)'));
    const res = await as(t).get(`/api/v1/applications/${world.app.id}/logs`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Failed to fetch logs');
    expect(res.text).not.toMatch(/ECONNREFUSED|docker\.sock|\/srv\/|\.ts:/);
  });

  it('turns an unexpected error into a generic 500 with no internal detail', async () => {
    const { owner, org, world } = await setup();
    const { token: t } = await token(org.id, owner.id, ['read']);
    const spy = jest
      .spyOn(access, 'ownerOfApplication')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432 at pool (/srv/app/db.ts:40)'));
    try {
      const res = await as(t).get(`/api/v1/applications/${world.app.id}`);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal error' } });
      expect(res.text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|\/srv\/|\.ts:/);
    } finally {
      spy.mockRestore();
    }
  });
});
