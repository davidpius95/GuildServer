import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { organizations, members, users } from "@guildserver/database";
import { eq, and } from "drizzle-orm";

const createOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  logo: z.string().url().optional(),
});

const updateOrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  logo: z.string().url().optional(),
});

const inviteMemberSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

const updateMemberSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["admin", "member"]),
  permissions: z.record(z.any()).optional(),
});

export const organizationRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    // Get organizations where user is a member
    const userOrganizations = await ctx.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        description: organizations.description,
        logo: organizations.logo,
        createdAt: organizations.createdAt,
        role: members.role,
        permissions: members.permissions,
      })
      .from(organizations)
      .innerJoin(members, eq(members.organizationId, organizations.id))
      .where(eq(members.userId, ctx.user.id));

    return userOrganizations;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user is a member of the organization
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.id),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this organization",
        });
      }

      const organization = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, input.id),
        with: {
          members: {
            with: {
              user: {
                columns: {
                  id: true,
                  email: true,
                  name: true,
                  avatar: true,
                },
              },
            },
          },
          projects: true,
        },
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return {
        ...organization,
        userRole: member.role,
        userPermissions: member.permissions,
      };
    }),

  create: protectedProcedure
    .input(createOrganizationSchema)
    .mutation(async ({ ctx, input }) => {
      const { name, slug, description, logo } = input;

      // Check if slug is already taken
      const existingOrg = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.slug, slug),
      });

      if (existingOrg) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Organization slug is already taken",
        });
      }

      // Create organization
      const [newOrg] = await ctx.db
        .insert(organizations)
        .values({
          name,
          slug,
          description,
          logo,
          ownerId: ctx.user.id,
        })
        .returning();

      // Add creator as owner
      await ctx.db.insert(members).values({
        userId: ctx.user.id,
        organizationId: newOrg.id,
        role: "owner",
        permissions: {
          admin: true,
          projects: ["create", "read", "update", "delete"],
          applications: ["create", "read", "update", "delete", "deploy"],
          databases: ["create", "read", "update", "delete"],
          workflows: ["create", "read", "update", "delete", "execute"],
          kubernetes: ["create", "read", "update", "delete"],
        },
      });

      return newOrg;
    }),

  update: protectedProcedure
    .input(updateOrganizationSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if user is owner or admin
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, id),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to update this organization",
        });
      }

      const [updatedOrg] = await ctx.db
        .update(organizations)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, id))
        .returning();

      return updatedOrg;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user is owner
      const organization = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, input.id),
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      if (organization.ownerId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can delete this organization",
        });
      }

      await ctx.db.delete(organizations).where(eq(organizations.id, input.id));

      return { success: true };
    }),

  getMembers: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user is a member
      const userMember = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!userMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this organization",
        });
      }

      const organizationMembers = await ctx.db.query.members.findMany({
        where: eq(members.organizationId, input.organizationId),
        with: {
          user: {
            columns: {
              id: true,
              email: true,
              name: true,
              avatar: true,
              lastLogin: true,
            },
          },
        },
      });

      return organizationMembers;
    }),

  updateMember: protectedProcedure
    .input(updateMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId, role, permissions } = input;

      // Check if user is owner or admin
      const userMember = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!userMember || (userMember.role !== "owner" && userMember.role !== "admin")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to update members",
        });
      }

      const [updatedMember] = await ctx.db
        .update(members)
        .set({
          role,
          permissions,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(members.organizationId, organizationId),
            eq(members.userId, userId)
          )
        )
        .returning();

      return updatedMember;
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = input;

      // Check if user is owner or admin
      const userMember = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!userMember || (userMember.role !== "owner" && userMember.role !== "admin")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to remove members",
        });
      }

      // Don't allow removing the owner
      const organization = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, organizationId),
      });

      if (organization?.ownerId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the organization owner",
        });
      }

      await ctx.db
        .delete(members)
        .where(
          and(
            eq(members.organizationId, organizationId),
            eq(members.userId, userId)
          )
        );

      return { success: true };
    }),
});