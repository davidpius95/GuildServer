/**
 * deployment.list must only return the requested organization's deployments,
 * and only to a member of that organization.
 *
 * Regression test for a cross-tenant leak: the membership check was written
 * `eq(members.organizationId, id) && eq(members.userId, userId)`. JavaScript's
 * `&&` returns its second operand, so only the user id reached the database and
 * any member of any organization passed. The query that followed had no
 * organization filter of its own.
 */
import { db, users, organizations, members, projects, applications, deployments, databases, services } from '@guildserver/database';
import { deploymentRouter } from '../../src/routers/deployment';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function tenant(label: string) {
  const s = stamp();
  const [user] = await db.insert(users).values({ email: `${label}-${s}@example.com`, name: label } as any).returning();
  const [org] = await db.insert(organizations).values({ name: `${label} ${s}`, slug: `${label}-${s}`, ownerId: user.id } as any).returning();
  await db.insert(members).values({ userId: user.id, organizationId: org.id, role: 'owner' } as any);
  const [project] = await db.insert(projects).values({ name: `${label} project`, organizationId: org.id } as any).returning();
  const [app] = await db
    .insert(applications)
    .values({ name: `${label}-app-${s}`, appName: `${label}-app-${s}`, projectId: project.id } as any)
    .returning();
  const [deployment] = await db
    .insert(deployments)
    .values({ applicationId: app.id, title: `${label} deploy`, status: 'completed' } as any)
    .returning();
  return { user, org, app, deployment };
}

function callerFor(user: { id: string; email: string; name: string | null }) {
  return deploymentRouter.createCaller({
    db,
    req: {} as any,
    res: {} as any,
    user: { ...user, role: 'user' },
    isAuthenticated: true,
    isAdmin: false,
  } as any);
}

describe('deployment.list organization isolation', () => {
  it('returns no data at all to a stranger, not merely an error after the fact', async () => {
    // Measured before the fix: a non-member asking for another organization got
    // that organization's deployment titles, application names and projects.
    const alice = await tenant('alice');
    const bob = await tenant('bob');
    let rows: any[] | undefined;
    try {
      rows = (await callerFor(alice.user).list({ organizationId: bob.org.id, limit: 500 })) as any[];
    } catch {
      rows = undefined;
    }
    expect(rows).toBeUndefined();
  });

  it("includes the organization's database and stack deployments, and no one else's", async () => {
    const alice = await tenant('alice');
    const bob = await tenant('bob');
    const [aliceProject] = await db.select().from(projects).where((await import('drizzle-orm')).eq(projects.organizationId, alice.org.id));
    const [bobProject] = await db.select().from(projects).where((await import('drizzle-orm')).eq(projects.organizationId, bob.org.id));
    const s = stamp();
    const [aliceDb] = await db.insert(databases).values({ name: `db-${s}`, type: 'postgresql', databaseName: 'x', username: 'u', password: 'p', projectId: aliceProject.id } as any).returning();
    const [bobSvc] = await db.insert(services).values({ name: `svc-${s}`, serviceName: `svc-${s}`, composeFile: 'services: {}', projectId: bobProject.id } as any).returning();
    const [aliceSvc] = await db.insert(services).values({ name: `svc2-${s}`, serviceName: `svc2-${s}`, composeFile: 'services: {}', projectId: aliceProject.id } as any).returning();
    const [dbDeploy] = await db.insert(deployments).values({ databaseId: aliceDb.id, title: 'alice db', status: 'completed' } as any).returning();
    const [aliceSvcDeploy] = await db.insert(deployments).values({ serviceId: aliceSvc.id, title: 'alice stack', status: 'completed' } as any).returning();
    const [bobSvcDeploy] = await db.insert(deployments).values({ serviceId: bobSvc.id, title: 'bob stack', status: 'completed' } as any).returning();

    const ids = ((await callerFor(alice.user).list({ organizationId: alice.org.id, limit: 500 })) as any[]).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([alice.deployment.id, dbDeploy.id, aliceSvcDeploy.id]));
    expect(ids).not.toContain(bob.deployment.id);
    expect(ids).not.toContain(bobSvcDeploy.id);
  });

  it("refuses a member of another organization", async () => {
    const alice = await tenant('alice');
    const bob = await tenant('bob');
    await expect(callerFor(alice.user).list({ organizationId: bob.org.id })).rejects.toThrow(/access/i);
  });

  it("never includes another organization's deployments in a member's own list", async () => {
    const alice = await tenant('alice');
    const bob = await tenant('bob');
    const rows = (await callerFor(alice.user).list({ organizationId: alice.org.id, limit: 500 })) as any[];
    const ids = rows.map((d) => d.id);
    expect(ids).toContain(alice.deployment.id);
    expect(ids).not.toContain(bob.deployment.id);
  });
});
