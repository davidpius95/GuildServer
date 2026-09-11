/**
 * Keep a token inside its own organization and project restriction.
 *
 * This is the one check tRPC cannot make. A token acts as its user, and the
 * tRPC procedures authorize that user across EVERY organization they belong
 * to. A token is bound to one organization, so before any procedure is called
 * each resource is resolved to its organization and project here, and anything
 * outside the token's reach is a 404 — the same response as a resource that
 * does not exist, so existence never leaks across tenants.
 *
 * These lookups only read ownership columns; authorization of the user and the
 * data returned still come from the tRPC procedures.
 */
import { eq } from "drizzle-orm";
import { applications, databases, db, deployments, projects, services } from "@guildserver/database";
import type { AuthenticatedToken } from "../../services/api-tokens";
import { RestError, notFound } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Ownership {
  organizationId: string | null;
  projectId: string | null;
}

/** A malformed id cannot name a resource; answer as for a missing one. */
export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw notFound();
  return value;
}

export function inReach(token: AuthenticatedToken, owner: Ownership | null): boolean {
  if (!owner || owner.organizationId !== token.organizationId) return false;
  if (token.projectIds === null) return true;
  return owner.projectId !== null && token.projectIds.includes(owner.projectId);
}

export function assertInReach(token: AuthenticatedToken, owner: Ownership | null): void {
  if (!inReach(token, owner)) throw notFound();
}

export function projectInReach(token: AuthenticatedToken, projectId: string | null | undefined): boolean {
  return token.projectIds === null || (!!projectId && token.projectIds.includes(projectId));
}

async function projectOwner(projectId: string | null): Promise<Ownership | null> {
  if (!projectId) return null;
  const [row] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ? { organizationId: row.organizationId, projectId } : null;
}

export async function ownerOfProject(id: string): Promise<Ownership | null> {
  return projectOwner(requireUuid(id));
}

export async function ownerOfApplication(id: string): Promise<Ownership | null> {
  const [row] = await db
    .select({ projectId: applications.projectId })
    .from(applications)
    .where(eq(applications.id, requireUuid(id)))
    .limit(1);
  return row ? projectOwner(row.projectId) : null;
}

export async function ownerOfDatabase(id: string): Promise<Ownership | null> {
  const [row] = await db
    .select({ projectId: databases.projectId })
    .from(databases)
    .where(eq(databases.id, requireUuid(id)))
    .limit(1);
  return row ? projectOwner(row.projectId) : null;
}

export async function ownerOfService(id: string): Promise<Ownership | null> {
  const [row] = await db
    .select({ projectId: services.projectId })
    .from(services)
    .where(eq(services.id, requireUuid(id)))
    .limit(1);
  return row ? projectOwner(row.projectId) : null;
}

export async function ownerOfDeployment(id: string): Promise<Ownership | null> {
  const [row] = await db
    .select({ applicationId: deployments.applicationId, databaseId: deployments.databaseId, serviceId: deployments.serviceId })
    .from(deployments)
    .where(eq(deployments.id, requireUuid(id)))
    .limit(1);
  if (!row) return null;
  if (row.applicationId) return ownerOfApplication(row.applicationId);
  if (row.databaseId) return ownerOfDatabase(row.databaseId);
  if (row.serviceId) return ownerOfService(row.serviceId);
  return null;
}

export function badRequest(message: string): RestError {
  return new RestError("BAD_REQUEST", message);
}
