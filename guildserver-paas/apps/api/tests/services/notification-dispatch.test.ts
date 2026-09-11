/**
 * Fan-out to organization channels against the test database: who receives an
 * event, that each occurrence reaches each channel once, and what is recorded
 * when a channel fails. Outbound HTTP is intercepted; nothing leaves the host.
 */
jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db, users, organizations, members, notificationChannels, notificationDeliveries, notifications } from '@guildserver/database';
import { encryptSecret } from '../../src/utils/crypto';
import { dispatchToOrganization, redactDeliveryError, subscribedEvents } from '../../src/services/notifications/dispatch';
import { notify } from '../../src/services/notification';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const token = () => randomUUID().replace(/-/g, '');

async function world() {
  const s = stamp();
  const [owner] = await db.insert(users).values({ email: `n-own-${s}@example.com`, name: 'owner' } as any).returning();
  const [org] = await db.insert(organizations).values({ name: `n ${s}`, slug: `n-${s}`, ownerId: owner.id } as any).returning();
  await db.insert(members).values({ userId: owner.id, organizationId: org.id, role: 'owner' } as any);
  return { owner, org };
}

async function channel(
  organizationId: string,
  opts: { type: 'slack' | 'discord' | 'webhook'; url: string; events: string[]; enabled?: boolean },
) {
  const [row] = await db
    .insert(notificationChannels)
    .values({
      organizationId,
      name: `${opts.type} channel`,
      type: opts.type,
      config: {},
      secret: encryptSecret(JSON.stringify({ url: opts.url })),
      events: opts.events,
      enabled: opts.enabled ?? true,
    } as any)
    .returning();
  return row;
}

const slackUrl = () => `https://hooks.slack.com/services/T${token().slice(0, 8)}/B${token().slice(0, 8)}/${token()}`;
const discordUrl = () => `https://discord.com/api/webhooks/${Date.now()}/${token()}`;
// An IP literal in TEST-NET-3: public by classification, so no DNS lookup is needed.
const hookUrl = () => `https://203.0.113.10/hooks/${token()}`;

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
});
afterEach(() => fetchSpy.mockRestore());

const callsTo = (url: string) => fetchSpy.mock.calls.filter(([target]) => target === url).length;

async function deliveriesOf(channelId: string) {
  return db.select().from(notificationDeliveries).where(eq(notificationDeliveries.channelId, channelId));
}

describe('dispatchToOrganization', () => {
  it("delivers only to the organization's enabled channels subscribed to the event", async () => {
    const a = await world();
    const b = await world();
    const subscribed = await channel(a.org.id, { type: 'slack', url: slackUrl(), events: ['deployment_failed'] });
    const otherEvent = await channel(a.org.id, { type: 'discord', url: discordUrl(), events: ['deployment_success'] });
    const disabled = await channel(a.org.id, { type: 'webhook', url: hookUrl(), events: ['deployment_failed'], enabled: false });
    const otherOrg = await channel(b.org.id, { type: 'slack', url: slackUrl(), events: ['deployment_failed'] });

    const results = await dispatchToOrganization(a.org.id, 'deployment_failed', { appName: 'shop', error: 'boom', dedupeKey: randomUUID() }, { retryDelaysMs: [] });

    expect(results).toEqual([{ channelId: subscribed.id, status: 'sent' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const quiet of [otherEvent, disabled, otherOrg]) {
      expect(await deliveriesOf(quiet.id)).toHaveLength(0);
    }
  });

  it('delivers an occurrence once per channel, however many times and however concurrently it is reported', async () => {
    const { org } = await world();
    const slack = slackUrl();
    const hook = hookUrl();
    const s = await channel(org.id, { type: 'slack', url: slack, events: ['backup_failed'] });
    const h = await channel(org.id, { type: 'webhook', url: hook, events: ['backup_failed'] });
    const occurrence = randomUUID();
    const report = () => dispatchToOrganization(org.id, 'backup_failed', { databaseName: 'db', dedupeKey: occurrence }, { retryDelaysMs: [] });

    const concurrent = await Promise.all([report(), report(), report()]);
    const later = await report();

    expect(callsTo(slack)).toBe(1);
    expect(callsTo(hook)).toBe(1);
    const statuses = [...concurrent.flat(), ...later].map((r) => r.status).sort();
    expect(statuses.filter((st) => st === 'sent')).toHaveLength(2);
    expect(statuses.filter((st) => st === 'duplicate')).toHaveLength(6);
    expect(await deliveriesOf(s.id)).toHaveLength(1);
    expect(await deliveriesOf(h.id)).toHaveLength(1);

    // A different occurrence of the same event is news.
    await dispatchToOrganization(org.id, 'backup_failed', { databaseName: 'db', dedupeKey: randomUUID() }, { retryDelaysMs: [] });
    expect(callsTo(slack)).toBe(2);
  });

  it('retries a transient failure and records the attempts', async () => {
    const { org } = await world();
    const c = await channel(org.id, { type: 'discord', url: discordUrl(), events: ['deployment_failed'] });
    fetchSpy.mockResolvedValueOnce({ status: 503 } as Response);

    const [result] = await dispatchToOrganization(org.id, 'deployment_failed', { appName: 'shop', dedupeKey: randomUUID() }, { retryDelaysMs: [0, 0] });

    expect(result.status).toBe('sent');
    const [delivery] = await deliveriesOf(c.id);
    expect(delivery).toMatchObject({ status: 'sent', attempts: 2, error: null });
    expect(delivery.deliveredAt).not.toBeNull();
    const [row] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, c.id));
    expect(row.lastDeliveryOk).toBe(true);
  });

  it('gives up on a permanent failure at once, recording why without the webhook URL', async () => {
    const { org } = await world();
    const url = slackUrl();
    const c = await channel(org.id, { type: 'slack', url, events: ['deployment_failed'] });
    fetchSpy.mockResolvedValue({ status: 404 } as Response);

    const [result] = await dispatchToOrganization(org.id, 'deployment_failed', { appName: 'shop', dedupeKey: randomUUID() }, { retryDelaysMs: [0, 0] });

    expect(result.status).toBe('failed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [delivery] = await deliveriesOf(c.id);
    expect(delivery).toMatchObject({ status: 'failed', attempts: 1 });
    expect(delivery.error).toMatch(/HTTP 404/);
    const [row] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, c.id));
    expect(row.lastDeliveryOk).toBe(false);
    expect(`${row.lastError} ${delivery.error}`).not.toContain(url.split('/').pop()!);
  });

  it('stops after the configured retries when the target stays unreachable', async () => {
    const { org } = await world();
    const url = hookUrl();
    const c = await channel(org.id, { type: 'webhook', url, events: ['deployment_failed'] });
    fetchSpy.mockRejectedValue(new Error(`fetch failed for ${url}`));

    await dispatchToOrganization(org.id, 'deployment_failed', { appName: 'shop', dedupeKey: randomUUID() }, { retryDelaysMs: [0, 0] });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [delivery] = await deliveriesOf(c.id);
    expect(delivery).toMatchObject({ status: 'failed', attempts: 3 });
    expect(delivery.error).not.toContain(url);
  });
});

describe('a failed deploy', () => {
  it('produces exactly one notification per subscribed channel, and one in-app notification', async () => {
    const { owner, org } = await world();
    const targets = [slackUrl(), discordUrl(), hookUrl()];
    await channel(org.id, { type: 'slack', url: targets[0], events: ['deployment_failed', 'deployment_success'] });
    await channel(org.id, { type: 'discord', url: targets[1], events: ['deployment_failed'] });
    await channel(org.id, { type: 'webhook', url: targets[2], events: ['deployment_failed'] });
    const unsubscribed = slackUrl();
    await channel(org.id, { type: 'slack', url: unsubscribed, events: ['deployment_success'] });
    const deploymentId = randomUUID();

    await notify('deployment_failed', owner.id, org.id, { appName: 'shop', error: 'build exited 1', dedupeKey: deploymentId });
    // The same deployment reported again (a retried job) changes nothing for channels.
    await notify('deployment_failed', owner.id, org.id, { appName: 'shop', error: 'build exited 1', dedupeKey: deploymentId });

    for (const url of targets) expect(callsTo(url)).toBe(1);
    expect(callsTo(unsubscribed)).toBe(0);

    const webhookCall = fetchSpy.mock.calls.find(([target]) => target === targets[2])!;
    expect(JSON.parse(webhookCall[1].body)).toMatchObject({ event: 'deployment_failed', title: 'shop deployment failed' });

    const inbox = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner.id), eq(notifications.type, 'deployment_failed')));
    expect(inbox.length).toBeGreaterThanOrEqual(1);
    expect(inbox[0].title).toContain('shop deployment failed');
  });
});

describe('subscribedEvents', () => {
  // drizzle-orm 0.29 on postgres-js stores jsonb as a JSON-encoded string, so a
  // SQL containment test matched a one-event channel only by coincidence and
  // never matched a channel subscribed to two events.
  it('reads a subscription list however the jsonb value was encoded', () => {
    const events = ['deployment_failed', 'deployment_success'];
    expect(subscribedEvents({ events })).toEqual(events);
    expect(subscribedEvents({ events: JSON.stringify(events) as any })).toEqual(events);
    expect(subscribedEvents({ events: 'not json' as any })).toEqual([]);
    expect(subscribedEvents({ events: { deployment_failed: true } as any })).toEqual([]);
  });
});

describe('redactDeliveryError', () => {
  it('removes stored secrets and anything shaped like a webhook URL or bot token', () => {
    const secret = { url: 'https://203.0.113.10/hook?key=abc123', signingSecret: 'whsec_0123456789abcdef' };
    const text = redactDeliveryError(
      `failed https://203.0.113.10/hook?key=abc123 whsec_0123456789abcdef https://hooks.slack.com/services/T/B/tok https://discord.com/api/webhooks/1/tok bot123456:AAAAsecret`,
      secret,
    );
    expect(text).not.toMatch(/abc123|whsec_|services\/T|webhooks\/1|AAAAsecret/);
  });
});
