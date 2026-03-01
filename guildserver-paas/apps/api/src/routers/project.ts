import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { projects, members, organizations } from "@guildserver/database";
import { eq, and, desc } from "drizzle-orm";

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  organizationId: z.string().uuid(),
  environment: z.record(z.string()).default({}),
});

const updateProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  environment: z.record(z.string()).optional(),
});

export const projectRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user is a member of the organization
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this organization",
        });
      }

      const organizationProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.organizationId, input.organizationId),
        orderBy: [desc(projects.createdAt)],
        with: {
          applications: {
            columns: {
              id: true,
              name: true,
              status: true,
            },
          },
          databases: {
            columns: {
              id: true,
              name: true,
              type: true,
              status: true,
            },
          },
        },
      });

      return organizationProjects;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
        with: {
          organization: {
            with: {
              members: {
                where: eq(members.userId, ctx.user.id),
              },
            },
          },
          applications: {
            orderBy: [desc(projects.createdAt)],
          },
          databases: {
            orderBy: [desc(projects.createdAt)],
          },
        },
      });

      if (!project || project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found or access denied",
        });
      }

      return project;
    }),

  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if user is a member of the organization
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this organization",
        });
      }

      const [newProject] = await ctx.db
        .insert(projects)
        .values({
          name: input.name,
          description: input.description,
          organizationId: input.organizationId,
          environment: input.environment || {},
        })
        .returning();

      return newProject;
    }),

  update: protectedProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if user has access to the project
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, id),
        with: {
          organization: {
            with: {
              members: {
                where: eq(members.userId, ctx.user.id),
              },
            },
          },
        },
      });

      if (!project || project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found or access denied",
        });
      }

      const [updatedProject] = await ctx.db
        .update(projects)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning();

      return updatedProject;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to the project
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
        with: {
          organization: {
            with: {
              members: {
                where: eq(members.userId, ctx.user.id),
              },
            },
          },
        },
      });

      if (!project || project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found or access denied",
        });
      }

      await ctx.db.delete(projects).where(eq(projects.id, input.id));

      return { success: true };
    }),
});