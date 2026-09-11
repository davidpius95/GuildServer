import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { members } from "@guildserver/database";

export type OrganizationRole = "owner" | "admin" | "member";

export async function organizationRole(ctx: any, organizationId: string): Promise<OrganizationRole | undefined> {
  const member = await ctx.db.query.members.findFirst({
    where: and(eq(members.organizationId, organizationId), eq(members.userId, ctx.user.id)),
  });
  return member?.role as OrganizationRole | undefined;
}

/** Non-members get NOT_FOUND, so an organization's existence is not confirmed. */
export async function requireOrganizationMember(ctx: any, organizationId: string): Promise<OrganizationRole> {
  const role = await organizationRole(ctx, organizationId);
  if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found or access denied" });
  return role;
}

export async function requireOrganizationManager(ctx: any, organizationId: string, what: string): Promise<OrganizationRole> {
  const role = await requireOrganizationMember(ctx, organizationId);
  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: `Only an organization owner or admin can manage ${what}` });
  }
  return role;
}
