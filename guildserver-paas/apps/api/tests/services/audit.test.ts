/**
 * Dashboard audit entries: who did what, from where, and never at the cost
 * of the action itself.
 */
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, auditLogs, users, organizations } from '@guildserver/database';
import { recordAudit, clientIp } from '../../src/services/audit';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function world() {
  const s = stamp();
  const [user] = await db.insert(users).values({ email: `au-${s}@example.com`, name: 'au' } as any).returning();
  const [org] = await db.insert(organizations).values({ name: `au ${s}`, slug: `au-${s}`, ownerId: user.id } as any).returning();
  return { user, org };
}

const request = (ip: string, agent = 'Mozilla/5.0') => ({ ip, get: (h: string) => (h === 'User-Agent' ? agent : undefined) });

describe('recordAudit', () => {
  it('records who acted, on what, and from where', async () => {
    const { user, org } = await world();
    const resourceId = randomUUID();

    await recordAudit(
      { userId: user.id, organizationId: org.id, action: 'application.deleted', resourceType: 'application', resourceId, resourceName: 'checkout' },
      request('203.0.113.7'),
    );

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, resourceId));
    expect(row).toMatchObject({
      userId: user.id,
      organizationId: org.id,
      action: 'application.deleted',
      resourceType: 'application',
      resourceName: 'checkout',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
    expect(row.metadata).toMatchObject({ via: 'dashboard' });
  });

  it('stores no address rather than failing the insert when the ip is unparseable', async () => {
    const { user, org } = await world();
    const resourceId = randomUUID();

    await recordAudit(
      { userId: user.id, organizationId: org.id, action: 'database.deleted', resourceType: 'database', resourceId },
      request('::ffff:not-an-ip'),
    );

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, resourceId));
    expect(row.ipAddress).toBeNull();
    expect(row.action).toBe('database.deleted');
  });

  it('keeps caller-supplied metadata alongside the channel it came through', async () => {
    const { user, org } = await world();
    const resourceId = randomUUID();

    await recordAudit({
      userId: user.id,
      organizationId: org.id,
      action: 'application.deployed',
      resourceType: 'application',
      resourceId,
      metadata: { deploymentId: 'dep-1', commit: 'abc1234' },
    });

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, resourceId));
    expect(row.metadata).toMatchObject({ via: 'dashboard', deploymentId: 'dep-1', commit: 'abc1234' });
    expect(row.ipAddress).toBeNull();
  });

  it('never throws when the row cannot be written, because the action already happened', async () => {
    const { user } = await world();
    // An organization that does not exist: the foreign key rejects the row.
    await expect(
      recordAudit({ userId: user.id, organizationId: randomUUID(), action: 'project.deleted', resourceType: 'project', resourceId: randomUUID() }),
    ).resolves.toBeUndefined();
  });

  it('accepts no request at all, for actions taken outside a request', () => {
    expect(clientIp(undefined)).toBeNull();
    expect(clientIp({ ip: '198.51.100.4' })).toBe('198.51.100.4');
  });
});
