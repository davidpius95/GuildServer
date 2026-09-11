/**
 * Token management through tRPC: dashboard sessions only, with role limits.
 */
jest.mock('../../src/queues/setup', () => {
  throw new Error('queues/setup must not load in these tests: it opens Redis and starts BullMQ workers');
});
const mockProxy = () => new Proxy({ __esModule: true } as any, { get: (t, k) => (k in t ? t[k] : (t[k] = jest.fn())) });
jest.mock('../../src/queues/deployment', () => mockProxy());
jest.mock('../../src/queues/backups', () => mockProxy());
jest.mock('../../src/queues/instances', () => mockProxy());
jest.mock('../../src/queues/crypto-payments', () => mockProxy());
jest.mock('../../src/services/db-backup', () => mockProxy());
jest.mock('../../src/services/database-provision', () => mockProxy());
jest.mock('../../src/services/compose/deploy', () => mockProxy());
jest.mock('../../src/providers/factory', () => mockProxy());
jest.mock('../../src/websocket/server', () => mockProxy());

import { db } from '@guildserver/database';
import { apiTokenRouter } from '../../src/routers/api-token';
import { createContext } from '../../src/trpc/context';
import { addMember, makeOrg, makeUser, token } from './fixtures';

function ctxFor(user: { id: string; email: string; name: string | null }, extra: Record<string, unknown> = {}) {
  return { db, req: {} as any, res: {} as any, user: { ...user, role: 'user' }, isAuthenticated: true, isAdmin: false, ...extra } as any;
}

async function orgWithRoles() {
  const owner = await makeUser('owner');
  const org = await makeOrg(owner, 'mgmt');
  const member = await makeUser('member');
  await addMember(member.id, org.id, 'member');
  const stranger = await makeUser('stranger');
  return { owner, org, member, stranger };
}

describe('apiToken.create', () => {
  it('returns the plaintext once and never the hash', async () => {
    const { owner, org } = await orgWithRoles();
    const created = await apiTokenRouter.createCaller(ctxFor(owner)).create({ organizationId: org.id, name: 'ci', scopes: ['deploy'] });
    expect(created.token).toMatch(/^gs_pat_/);
    expect(JSON.stringify(created)).not.toMatch(/tokenHash/);
  });

  it('lets a plain member grant only read and deploy', async () => {
    const { member, org } = await orgWithRoles();
    const caller = apiTokenRouter.createCaller(ctxFor(member));
    await expect(caller.create({ organizationId: org.id, name: 'ok', scopes: ['read', 'deploy'] })).resolves.toBeDefined();
    await expect(caller.create({ organizationId: org.id, name: 'w', scopes: ['write'] })).rejects.toThrow(/owner or admin/i);
    await expect(caller.create({ organizationId: org.id, name: 'a', scopes: ['admin'] })).rejects.toThrow(/owner or admin/i);
  });

  it('lets an owner grant any scope, and refuses non-members', async () => {
    const { owner, stranger, org } = await orgWithRoles();
    await expect(apiTokenRouter.createCaller(ctxFor(owner)).create({ organizationId: org.id, name: 'root', scopes: ['admin'] })).resolves.toBeDefined();
    await expect(apiTokenRouter.createCaller(ctxFor(stranger)).create({ organizationId: org.id, name: 'x', scopes: ['read'] })).rejects.toThrow();
  });

  it('refuses a caller that is itself authenticated by an API token', async () => {
    // One credential must never be able to mint another.
    const { owner, org } = await orgWithRoles();
    const tokenCtx = ctxFor(owner, { apiToken: { id: 'x', organizationId: org.id, scopes: ['admin'] } });
    await expect(apiTokenRouter.createCaller(tokenCtx).create({ organizationId: org.id, name: 'mint', scopes: ['admin'] })).rejects.toThrow(/API tokens cannot/);
  });
});

describe('apiToken.list', () => {
  it('never includes the hash', async () => {
    const { owner, org } = await orgWithRoles();
    await token(org.id, owner.id, ['read']);
    const rows = await apiTokenRouter.createCaller(ctxFor(owner)).list({ organizationId: org.id });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/tokenHash|gs_pat_[A-Za-z0-9_-]{43}/);
  });
});

describe('apiToken.revoke', () => {
  it('allows the creator and an owner, and refuses a stranger without confirming the token exists', async () => {
    const { owner, member, stranger, org } = await orgWithRoles();
    const { record: memberToken } = await token(org.id, member.id, ['read']);
    await expect(apiTokenRouter.createCaller(ctxFor(stranger)).revoke({ id: memberToken.id })).rejects.toThrow(/not found/i);
    await expect(apiTokenRouter.createCaller(ctxFor(member)).revoke({ id: memberToken.id })).resolves.toMatchObject({ success: true });

    const { record: another } = await token(org.id, member.id, ['read']);
    await expect(apiTokenRouter.createCaller(ctxFor(owner)).revoke({ id: another.id })).resolves.toMatchObject({ success: true });
  });

  it('refuses a plain member revoking someone else’s token', async () => {
    const { owner, member, org } = await orgWithRoles();
    const { record: ownerToken } = await token(org.id, owner.id, ['admin']);
    await expect(apiTokenRouter.createCaller(ctxFor(member)).revoke({ id: ownerToken.id })).rejects.toThrow(/owner or admin/i);
  });
});

describe('/trpc authentication', () => {
  it('does not accept an API token as a dashboard session', async () => {
    const { owner, org } = await orgWithRoles();
    const { token: raw } = await token(org.id, owner.id, ['admin']);
    const ctx = await createContext({ req: { headers: { authorization: `Bearer ${raw}` } } as any, res: {} as any });
    expect(ctx.user).toBeNull();
    expect(ctx.isAuthenticated).toBe(false);
  });
});
