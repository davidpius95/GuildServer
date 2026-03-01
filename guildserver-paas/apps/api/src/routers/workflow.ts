import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { workflowTemplates, workflowExecutions, approvalRequests, members } from "@guildserver/database";
import { eq, and, desc } from "drizzle-orm";

const createWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: z.object({
    steps: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(["action", "approval", "condition", "parallel"]),
      config: z.record(z.any()),
      nextSteps: z.array(z.string()).default([]),
    })),
    triggers: z.array(z.object({
      type: z.string(),
      config: z.record(z.any()),
    })).default([]),
  }),
  organizationId: z.string().uuid(),
});

const executeWorkflowSchema = z.object({
  templateId: z.string().uuid(),
  context: z.record(z.any()).default({}),
});

const approveRequestSchema = z.object({
  requestId: z.string().uuid(),
  approved: z.boolean(),
  comments: z.string().optional(),
});

export const workflowRouter = createTRPCRouter({
  listTemplates: protectedProcedure
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

      const templates = await ctx.db.query.workflowTemplates.findMany({
        where: eq(workflowTemplates.organizationId, input.organizationId),
        orderBy: [desc(workflowTemplates.createdAt)],
        with: {
          creator: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
          executions: {
            columns: {
              id: true,
              status: true,
              createdAt: true,
            },
            orderBy: [desc(workflowExecutions.createdAt)],
            limit: 5,
          },
        },
      });

      return templates;
    }),

  getTemplateById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, input.id),
        with: {
          organization: {
            with: {
              members: {
                where: eq(members.userId, ctx.user.id),
              },
            },
          },
          creator: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
          executions: {
            orderBy: [desc(workflowExecutions.createdAt)],
            limit: 10,
          },
        },
      });

      if (!template || template.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow template not found or access denied",
        });
      }

      return template;
    }),

  createTemplate: protectedProcedure
    .input(createWorkflowSchema)
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

      const [newTemplate] = await ctx.db
        .insert(workflowTemplates)
        .values({
          name: input.name,
          description: input.description,
          definition: input.definition,
          organizationId: input.organizationId,
          createdBy: ctx.user.id,
          status: "draft",
        })
        .returning();

      return newTemplate;
    }),

  updateTemplate: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        definition: z.record(z.any()).optional(),
        status: z.enum(["draft", "active", "inactive", "archived"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if user has access to update the template
      const template = await ctx.db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, id),
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

      if (!template || template.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow template not found or access denied",
        });
      }

      const [updatedTemplate] = await ctx.db
        .update(workflowTemplates)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(workflowTemplates.id, id))
        .returning();

      return updatedTemplate;
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to delete the template
      const template = await ctx.db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, input.id),
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

      if (!template || template.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow template not found or access denied",
        });
      }

      await ctx.db.delete(workflowTemplates).where(eq(workflowTemplates.id, input.id));

      return { success: true };
    }),

  executeWorkflow: protectedProcedure
    .input(executeWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      const { templateId, context } = input;

      // Check if user has access to execute the template
      const template = await ctx.db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, templateId),
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

      if (!template || template.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow template not found or access denied",
        });
      }

      if (template.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot execute inactive workflow template",
        });
      }

      const [execution] = await ctx.db
        .insert(workflowExecutions)
        .values({
          templateId,
          name: `${template.name} - ${new Date().toLocaleString()}`,
          status: "running",
          context,
          triggeredBy: ctx.user.id,
          organizationId: template.organizationId,
          startedAt: new Date(),
        })
        .returning();

      // TODO: Start workflow execution engine

      return execution;
    }),

  listExecutions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        templateId: z.string().uuid().optional(),
        status: z.enum(["pending", "running", "paused", "completed", "failed", "cancelled"]).optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
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

      let whereClause = eq(workflowExecutions.organizationId, input.organizationId);
      
      if (input.templateId) {
        whereClause = and(whereClause, eq(workflowExecutions.templateId, input.templateId));
      }
      
      if (input.status) {
        whereClause = and(whereClause, eq(workflowExecutions.status, input.status));
      }

      const executions = await ctx.db.query.workflowExecutions.findMany({
        where: whereClause,
        orderBy: [desc(workflowExecutions.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          template: {
            columns: {
              id: true,
              name: true,
            },
          },
          approvalRequests: {
            columns: {
              id: true,
              status: true,
            },
          },
        },
      });

      return executions;
    }),

  getExecutionById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const execution = await ctx.db.query.workflowExecutions.findFirst({
        where: eq(workflowExecutions.id, input.id),
        with: {
          template: true,
          approvalRequests: {
            with: {
              approver: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (!execution) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow execution not found",
        });
      }

      // Check if user has access (member of organization or involved in approval)
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, execution.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      const isApprover = execution.approvalRequests.some(
        (request) => request.approverId === ctx.user.id
      );

      if (!member && !isApprover) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this workflow execution",
        });
      }

      return execution;
    }),

  getApprovalRequests: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      let whereClause = eq(approvalRequests.approverId, ctx.user.id);
      
      if (input.status) {
        whereClause = and(whereClause, eq(approvalRequests.status, input.status));
      }

      const requests = await ctx.db.query.approvalRequests.findMany({
        where: whereClause,
        orderBy: [desc(approvalRequests.requestedAt)],
        limit: input.limit,
        with: {
          workflowExecution: {
            with: {
              template: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      return requests;
    }),

  approveRequest: protectedProcedure
    .input(approveRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const { requestId, approved, comments } = input;

      // Check if request exists and belongs to current user
      const request = await ctx.db.query.approvalRequests.findFirst({
        where: eq(approvalRequests.id, requestId),
      });

      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval request not found",
        });
      }

      if (request.approverId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only approve your own requests",
        });
      }

      if (request.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Request has already been processed",
        });
      }

      const [updatedRequest] = await ctx.db
        .update(approvalRequests)
        .set({
          status: approved ? "approved" : "rejected",
          comments,
          respondedAt: new Date(),
        })
        .where(eq(approvalRequests.id, requestId))
        .returning();

      // TODO: Continue workflow execution based on approval

      return updatedRequest;
    }),
});