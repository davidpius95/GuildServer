/**
 * Managing log drains: who may, which resources may be drained, where logs
 * may be sent, and what is never returned.
 */
jest.mock('../../src/queues/setup', () => {
  throw new Error('queues/setup must not load in log drain router tests');
});

import { eq } from 'drizzle-orm';
import { db, users, organizations, members, projects, applications, services, logDrains } from '@guildserver/database';
import { logDrainRouter } from '../../src/routers/log-drain';
import { loadDrainSpecs, saveDrainReport } from '../../src/services/log-drain/store';
import { encryptSecret } from '../../src/utils/crypto';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
// An IP literal in TEST-NET-3: public by classification, so no DNS is needed.
const ENDPOINT = 'https://203.0.113.20/ingest/path-secret?token=query-secret';

function ctx(user: { id: string; email: string; name: string | null }) {
  return { db, req: {} as any, res: {} as any, user: { ...user, role: 'user' }, isAuthenticated: true, isAdmin: false } as any;
}

async function org() {
  const s = stamp();
  const mk = async (tag: string) => (await db.insert(users).values({ email: `ld-${tag}-${s}@example.com`, name: tag } as any).returning())[0];
  const owner = await mk('own');
  const member = await mk('mem');
  const stranger = await mk('str');
  const [o] = await db.insert(organizations).values({ name: `ld ${s}`, slug: `ld-${s}`, ownerId: owner.id } as any).returning();
  await db.insert(members).values([
    { userId: owner.id, organizationId: o.id, role: 'owner' },
    { userId: member.id, organizationId: o.id, role: 'member' },
  ] as any);
  const [project] = await db.insert(projects).values({ name: 'p', organizationId: o.id } as any).returning();
  const [app] = await db.insert(applications).values({ name: `app-${s}`, appName: 'shop', projectId: project.id } as any).returning();
  const [stack] = await db
    .insert(services)
    .values({ name: 'stack', serviceName: `stack-${s}`, projectId: project.id, composeFile: 'services: {}' } as any)
    .returning();
  return { owner, member, stranger, org: o, app, stack };
}

const input = (w: Awaited<ReturnType<typeof org>>, over: Record<string, unknown> = {}) => ({
  organizationId: w.org.id,
  name: 'to fluent-bit',
  resource: { type: 'application' as const, id: w.app.id },
  target: { url: ENDPOINT, headers: { Authorization: 'Bearer header-secret' } },
  ...over,
});

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
});
afterEach(() => fetchSpy.mockRestore());

describe('permissions and secrecy', () => {
  it('lets members list drains without the endpoint path, query or header values; hides the organization from strangers', async () => {
    const w = await org();
    await logDrainRouter.createCaller(ctx(w.owner)).create(input(w));
    const rows = await logDrainRouter.createCaller(ctx(w.member)).list({ organizationId: w.org.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ host: '203.0.113.20', headerNames: ['Authorization'], format: 'json', resource: { type: 'application', id: w.app.id } });
    expect(JSON.stringify(rows)).not.toMatch(/path-secret|query-secret|header-secret|"secret"/);
    await expect(logDrainRouter.createCaller(ctx(w.stranger)).list({ organizationId: w.org.id })).rejects.toThrow(/not found/i);
  });

  it('lets only owners and admins create, update, test or delete', async () => {
    const w = await org();
    const drain = await logDrainRouter.createCaller(ctx(w.owner)).create(input(w));
    const caller = logDrainRouter.createCaller(ctx(w.member));
    await expect(caller.create(input(w))).rejects.toThrow(/owner or admin/);
    await expect(caller.update({ id: drain.id, enabled: false })).rejects.toThrow(/owner or admin/);
    await expect(caller.test({ id: drain.id })).rejects.toThrow(/owner or admin/);
    await expect(caller.delete({ id: drain.id })).rejects.toThrow(/owner or admin/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats another organization's drain as missing", async () => {
    const a = await org();
    const b = await org();
    const theirs = await logDrainRouter.createCaller(ctx(b.owner)).create(input(b));
    const caller = logDrainRouter.createCaller(ctx(a.owner));
    await expect(caller.update({ id: theirs.id, enabled: false })).rejects.toThrow(/not found/i);
    await expect(caller.test({ id: theirs.id })).rejects.toThrow(/not found/i);
    await expect(caller.delete({ id: theirs.id })).rejects.toThrow(/not found/i);
    expect(await db.select().from(logDrains).where(eq(logDrains.id, theirs.id))).toHaveLength(1);
  });
});

describe('resources', () => {
  it("refuses to drain another organization's application or stack", async () => {
    const a = await org();
    const b = await org();
    const caller = logDrainRouter.createCaller(ctx(a.owner));
    await expect(caller.create(input(a, { resource: { type: 'application', id: b.app.id } }))).rejects.toThrow(/Application not found/);
    await expect(caller.create(input(a, { resource: { type: 'service', id: b.stack.id } }))).rejects.toThrow(/Service not found/);
    expect(await db.select().from(logDrains).where(eq(logDrains.organizationId, a.org.id))).toHaveLength(0);
  });

  it('drains a Compose stack of its own organization', async () => {
    const w = await org();
    const drain = await logDrainRouter.createCaller(ctx(w.owner)).create(input(w, { resource: { type: 'service', id: w.stack.id } }));
    expect(drain.resource).toEqual({ type: 'service', id: w.stack.id });
  });
});

describe('targets', () => {
  it.each([
    ['http://127.0.0.1:2020/', /loopback/],
    ['http://169.254.169.254/latest/meta-data', /link-local/],
    ['http://192.168.1.10:8888/', /private/],
    ['ftp://203.0.113.20/', /http or https/],
  ])('refuses %s', async (url, reason) => {
    const w = await org();
    await expect(logDrainRouter.createCaller(ctx(w.owner)).create(input(w, { target: { url } }))).rejects.toThrow(reason);
  });

  it.each([
    [{ Host: 'internal.service' }, /set by GuildServer/],
    [{ 'X-Token': 'a\r\nX-Injected: 1' }, /Invalid value/],
  ])('refuses headers %j', async (headers, reason) => {
    const w = await org();
    await expect(logDrainRouter.createCaller(ctx(w.owner)).create(input(w, { target: { url: ENDPOINT, headers } }))).rejects.toThrow(reason);
  });

  it('re-validates a replacement target', async () => {
    const w = await org();
    const caller = logDrainRouter.createCaller(ctx(w.owner));
    const drain = await caller.create(input(w));
    await expect(caller.update({ id: drain.id, target: { url: 'http://10.1.1.1/' } })).rejects.toThrow(/private/);
    const updated = await caller.update({ id: drain.id, target: { url: 'https://203.0.113.21/v2', format: 'ndjson' }, enabled: false });
    expect(updated).toMatchObject({ host: '203.0.113.21', format: 'ndjson', enabled: false, headerNames: [] });
  });
});

describe('test', () => {
  it('sends one record and records the outcome without echoing the endpoint', async () => {
    const w = await org();
    const caller = logDrainRouter.createCaller(ctx(w.owner));
    const drain = await caller.create(input(w));

    await expect(caller.test({ id: drain.id })).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer header-secret');
    expect(JSON.parse(init.body)).toEqual([expect.objectContaining({ source: 'guildserver', message: expect.stringContaining('test') })]);

    fetchSpy.mockResolvedValueOnce({ status: 401 } as Response);
    const failed = await caller.test({ id: drain.id });
    expect(failed).toEqual({ ok: false, error: '203.0.113.20 answered HTTP 401' });
    const [row] = await caller.list({ organizationId: w.org.id });
    expect(row.lastDeliveryOk).toBe(false);
  });
});

describe('store', () => {
  it("loads enabled drains, skipping any whose resource is not the drain's organization's", async () => {
    const a = await org();
    const b = await org();
    const good = await logDrainRouter.createCaller(ctx(a.owner)).create(input(a));
    await logDrainRouter.createCaller(ctx(a.owner)).create(input(a, { name: 'off', enabled: false }));
    // A row pointing across organizations can only be written directly; the loader must still refuse it.
    const [crossed] = await db
      .insert(logDrains)
      .values({ organizationId: a.org.id, name: 'crossed', applicationId: b.app.id, secret: encryptSecret(JSON.stringify({ url: ENDPOINT }))!, format: 'json' } as any)
      .returning();

    const specs = (await loadDrainSpecs()).filter((s) => s.organizationId === a.org.id);
    expect(specs.map((s) => s.id)).toEqual([good.id]);
    expect(specs[0]).toMatchObject({ resourceType: 'application', resourceId: a.app.id, resourceName: 'shop', target: { url: ENDPOINT, headers: { Authorization: 'Bearer header-secret' }, format: 'json' } });
    expect(specs.map((s) => s.id)).not.toContain(crossed.id);
  });

  it('adds delivery counts to the stored totals', async () => {
    const w = await org();
    const drain = await logDrainRouter.createCaller(ctx(w.owner)).create(input(w));
    await saveDrainReport(drain.id, { ok: true, error: null, sent: 5, dropped: 1, at: new Date() });
    await saveDrainReport(drain.id, { ok: false, error: 'x answered HTTP 500', sent: 2, dropped: 0, at: new Date() });
    const [row] = await db.select().from(logDrains).where(eq(logDrains.id, drain.id));
    expect(row).toMatchObject({ recordsSent: 7, recordsDropped: 1, lastDeliveryOk: false, lastError: 'x answered HTTP 500' });
  });
});
