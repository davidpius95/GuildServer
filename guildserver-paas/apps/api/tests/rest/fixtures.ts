/**
 * Fixtures for the REST API tests: two organizations, one user in both, and
 * one of every resource type, so isolation can be tested against the exact
 * case a token is most likely to leak — a user who can legitimately see both.
 */
import { and, eq } from 'drizzle-orm';
import {
  db,
  users,
  organizations,
  members,
  projects,
  applications,
  databases,
  services,
  deployments,
  domains,
  auditLogs,
} from '@guildserver/database';
import { createApiToken } from '../../src/services/api-tokens';

export const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

export const DB_PASSWORD = 'supersecret-db-pass';


export async function makeUser(label = 'user') {
  const [user] = await db.insert(users).values({ email: `${label}-${stamp()}@example.com`, name: label } as any).returning();
  return user;
}

export async function makeOrg(owner: { id: string }, label: string) {
  const s = stamp();
  const [org] = await db.insert(organizations).values({ name: `${label} ${s}`, slug: `${label}-${s}`, ownerId: owner.id } as any).returning();
  await db.insert(members).values({ userId: owner.id, organizationId: org.id, role: 'owner' } as any);
  return org;
}

export async function addMember(userId: string, organizationId: string, role: 'owner' | 'admin' | 'member' = 'member') {
  await db.insert(members).values({ userId, organizationId, role } as any);
}

export async function removeMember(userId: string, organizationId: string) {
  await db.delete(members).where(and(eq(members.userId, userId), eq(members.organizationId, organizationId)));
}

/** A project with one of everything in it. */
export async function makeWorld(organizationId: string, label: string) {
  const s = stamp();
  const [project] = await db.insert(projects).values({ name: `${label}-project-${s}`, organizationId } as any).returning();
  const [app] = await db
    .insert(applications)
    .values({ name: `${label}-app-${s}`, appName: `${label}-app-${s}`, projectId: project.id, sourceType: 'docker', dockerImage: 'nginx', dockerTag: 'alpine' } as any)
    .returning();
  const [database] = await db
    .insert(databases)
    .values({ name: `${label}-db-${s}`, type: 'postgresql', databaseName: 'app', username: 'app', password: DB_PASSWORD, projectId: project.id } as any)
    .returning();
  const [service] = await db
    .insert(services)
    .values({
      name: `${label}-stack-${s}`,
      serviceName: `${label}-stack-${s}`,
      composeFile: 'services:\n  web:\n    image: nginx:alpine\n',
      projectId: project.id,
    } as any)
    .returning();
  const [deployment] = await db.insert(deployments).values({ applicationId: app.id, title: `${label} deploy`, status: 'completed' } as any).returning();
  const [domain] = await db.insert(domains).values({ domain: `${label}-${s}.example.test`, applicationId: app.id } as any).returning();
  return { project, app, database, service, deployment, domain };
}

export async function token(organizationId: string, userId: string, scopes: string[], extra: { projectIds?: string[] | null; expiresAt?: Date | null } = {}) {
  return createApiToken({ organizationId, userId, name: `t-${stamp()}`, scopes, ...extra });
}

export async function deploymentCountFor(applicationId: string) {
  return (await db.select().from(deployments).where(eq(deployments.applicationId, applicationId))).length;
}

export async function auditRowsFor(resourceId: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.resourceId, resourceId));
}
