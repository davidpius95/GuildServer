/**
 * Managing notification channels, and the legacy Slack procedures: who may do
 * what, what is stored, what is never returned, and where the server will
 * refuse to send.
 */
jest.mock('../../src/queues/setup', () => {
  throw new Error('queues/setup must not load in notification channel router tests');
});
jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

import { eq } from 'drizzle-orm';
import { db, users, organizations, members, notificationChannels, slackConfigs } from '@guildserver/database';
import { notificationChannelRouter } from '../../src/routers/notification-channel';
import { notificationRouter } from '../../src/routers/notification';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const SLACK = 'https://hooks.slack.com/services/T123/B456/routerSecretToken';
const TG_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';

function ctx(user: { id: string; email: string; name: string | null }) {
  return { db, req: {} as any, res: {} as any, user: { ...user, role: 'user' }, isAuthenticated: true, isAdmin: false } as any;
}

async function org() {
  const s = stamp();
  const mk = async (tag: string) => (await db.insert(users).values({ email: `${tag}-${s}@example.com`, name: tag } as any).returning())[0];
  const owner = await mk('own');
  const admin = await mk('adm');
  const member = await mk('mem');
  const stranger = await mk('str');
  const [o] = await db.insert(organizations).values({ name: `nc ${s}`, slug: `nc-${s}`, ownerId: owner.id } as any).returning();
  await db.insert(members).values([
    { userId: owner.id, organizationId: o.id, role: 'owner' },
    { userId: admin.id, organizationId: o.id, role: 'admin' },
    { userId: member.id, organizationId: o.id, role: 'member' },
  ] as any);
  return { owner, admin, member, stranger, org: o };
}

const slackInput = (organizationId: string, url = SLACK) => ({
  organizationId,
  name: 'deploys',
  events: ['deployment_failed' as const],
  target: { type: 'slack' as const, url },
});

let fetchSpy: jest.SpyInstance;
const savedEnv = { ...process.env };
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
});
afterEach(() => {
  fetchSpy.mockRestore();
  process.env = { ...savedEnv };
});

describe('permissions and secrecy', () => {
  it('lets members list channels without ever seeing credentials, and hides the organization from strangers', async () => {
    const { owner, member, stranger, org: o } = await org();
    const caller = notificationChannelRouter.createCaller(ctx(owner));
    await caller.create(slackInput(o.id));
    await caller.create({
      organizationId: o.id,
      name: 'hook',
      events: ['backup_failed'],
      target: { type: 'webhook', url: 'https://203.0.113.10/hook?token=querysecret', signingSecret: 'whsec_0123456789abcdef' },
    });
    await caller.create({ organizationId: o.id, name: 'tg', events: ['payment_failed'], target: { type: 'telegram', botToken: TG_TOKEN, chatId: '-100123' } });

    const rows = await notificationChannelRouter.createCaller(ctx(member)).list({ organizationId: o.id });
    expect(rows).toHaveLength(3);
    const text = JSON.stringify(rows);
    for (const secret of ['routerSecretToken', 'querysecret', 'whsec_', 'AAHdqTcvCH1', 'secret"']) {
      expect(text).not.toContain(secret);
    }
    expect(rows.find((r) => r.name === 'hook')!.target).toBe('203.0.113.10');

    await expect(notificationChannelRouter.createCaller(ctx(stranger)).list({ organizationId: o.id })).rejects.toThrow(/not found/i);
  });

  it('lets only owners and admins create, update, test or delete', async () => {
    const { admin, member, org: o } = await org();
    const created = await notificationChannelRouter.createCaller(ctx(admin)).create(slackInput(o.id));
    const caller = notificationChannelRouter.createCaller(ctx(member));
    await expect(caller.create(slackInput(o.id))).rejects.toThrow(/owner or admin/);
    await expect(caller.update({ id: created.id, enabled: false })).rejects.toThrow(/owner or admin/);
    await expect(caller.test({ id: created.id })).rejects.toThrow(/owner or admin/);
    await expect(caller.delete({ id: created.id })).rejects.toThrow(/owner or admin/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats another organization's channel as missing", async () => {
    const a = await org();
    const b = await org();
    const theirs = await notificationChannelRouter.createCaller(ctx(b.owner)).create(slackInput(b.org.id));
    const caller = notificationChannelRouter.createCaller(ctx(a.owner));
    await expect(caller.update({ id: theirs.id, enabled: false })).rejects.toThrow(/not found/i);
    await expect(caller.test({ id: theirs.id })).rejects.toThrow(/not found/i);
    await expect(caller.deliveries({ id: theirs.id })).rejects.toThrow(/not found/i);
    await expect(caller.delete({ id: theirs.id })).rejects.toThrow(/not found/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(notificationChannels).where(eq(notificationChannels.id, theirs.id))).toHaveLength(1);
  });
});

describe('targets', () => {
  it.each([
    [{ type: 'webhook' as const, url: 'http://127.0.0.1:9000/x' }, /loopback/],
    [{ type: 'webhook' as const, url: 'http://169.254.169.254/latest/meta-data' }, /link-local/],
    [{ type: 'webhook' as const, url: 'http://10.0.0.8/x' }, /private/],
    [{ type: 'slack' as const, url: 'https://hooks.slack.com.attacker.example/services/T/B/X' }, /hooks\.slack\.com/],
    [{ type: 'discord' as const, url: 'https://evil.example/api/webhooks/1/x' }, /Discord/],
    [{ type: 'telegram' as const, botToken: 'nope', chatId: '-100' }, /bot token/],
  ])('refuses %j', async (target, reason) => {
    const { owner, org: o } = await org();
    await expect(
      notificationChannelRouter.createCaller(ctx(owner)).create({ organizationId: o.id, name: 'x', events: ['deployment_failed'], target }),
    ).rejects.toThrow(reason);
    expect(await db.select().from(notificationChannels).where(eq(notificationChannels.organizationId, o.id))).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an email channel when the server cannot send email', async () => {
    delete process.env.SMTP_HOST;
    const { owner, org: o } = await org();
    await expect(
      notificationChannelRouter
        .createCaller(ctx(owner))
        .create({ organizationId: o.id, name: 'mail', events: ['backup_failed'], target: { type: 'email', recipients: ['ops@example.com'] } }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('refuses unknown events', async () => {
    const { owner, org: o } = await org();
    await expect(
      notificationChannelRouter.createCaller(ctx(owner)).create({ ...slackInput(o.id), events: ['everything'] as any }),
    ).rejects.toThrow();
  });

  it("keeps a channel's type fixed and re-validates a replacement target", async () => {
    const { owner, org: o } = await org();
    const caller = notificationChannelRouter.createCaller(ctx(owner));
    const created = await caller.create(slackInput(o.id));
    await expect(caller.update({ id: created.id, target: { type: 'discord', url: 'https://discord.com/api/webhooks/1/abc' } })).rejects.toThrow(/cannot be changed/);
    await expect(caller.update({ id: created.id, target: { type: 'slack', url: 'http://169.254.169.254/' } })).rejects.toThrow(/hooks\.slack\.com/);
    const updated = await caller.update({ id: created.id, events: ['backup_failed', 'backup_failed', 'payment_failed'], enabled: false, name: 'renamed' });
    expect(updated).toMatchObject({ name: 'renamed', enabled: false, events: ['backup_failed', 'payment_failed'] });
  });
});

describe('test', () => {
  it('sends a message and records the outcome, without echoing the webhook URL', async () => {
    const { owner, org: o } = await org();
    const caller = notificationChannelRouter.createCaller(ctx(owner));
    const created = await caller.create(slackInput(o.id));

    await expect(caller.test({ id: created.id })).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(SLACK);

    fetchSpy.mockResolvedValueOnce({ status: 404 } as Response);
    const failed = await caller.test({ id: created.id });
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).toMatch(/404/);
    expect(JSON.stringify(failed)).not.toContain('routerSecretToken');
    const [row] = await caller.list({ organizationId: o.id });
    expect(row.lastDeliveryOk).toBe(false);
  });
});

describe('legacy Slack procedures', () => {
  async function withLegacySlack() {
    const w = await org();
    await db.insert(slackConfigs).values({ organizationId: w.org.id, webhookUrl: SLACK, channelName: 'ops', enabled: true } as any);
    return w;
  }

  it('getSlackConfig says a webhook is set without returning it', async () => {
    const { member, org: o } = await withLegacySlack();
    const config = await notificationRouter.createCaller(ctx(member)).getSlackConfig({ organizationId: o.id });
    expect(config).toMatchObject({ hasWebhook: true, channelName: 'ops' });
    expect(JSON.stringify(config)).not.toContain('routerSecretToken');
  });

  it('testSlackNotification requires an owner or admin of that organization', async () => {
    const { owner, member, stranger, org: o } = await withLegacySlack();
    await expect(notificationRouter.createCaller(ctx(stranger)).testSlackNotification({ organizationId: o.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(notificationRouter.createCaller(ctx(member)).testSlackNotification({ organizationId: o.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(notificationRouter.createCaller(ctx(owner)).testSlackNotification({ organizationId: o.id })).resolves.toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('setSlackConfig refuses anything but a Slack webhook URL', async () => {
    const { owner, org: o } = await org();
    await expect(
      notificationRouter.createCaller(ctx(owner)).setSlackConfig({ organizationId: o.id, webhookUrl: 'http://169.254.169.254/latest' }),
    ).rejects.toThrow(/hooks\.slack\.com/);
  });
});
