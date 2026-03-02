import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { deployments, applications, databases, members, projects } from "@guildserver/database";
import { eq, desc, or, and, inArray, sql, gte, lte } from "drizzle-orm";

export const deploymentRouter = createTRPCRouter({
  // List all deployments the user has access to (across all projects/orgs)
  listAll: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(30),
        offset: z.number().default(0),
        status: z.enum(["pending", "building", "deploying", "running", "completed", "failed", "cancelled"]).optional(),
        applicationId: z.string().uuid().optional(),
        timeRange: z.enum(["24h", "7d", "30d", "all"]).default("all"),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get all organizations the user is a member of
      const userMembers = await ctx.db.query.members.findMany({
        where: eq(members.userId, ctx.user.id),
        columns: { organizationId: true },
      });

      if (userMembers.length === 0) {
        return { deployments: [], total: 0 };
      }

      const orgIds = userMembers.map((m) => m.organizationId);

      // Get all projects in those organizations
      const userProjects = await ctx.db.query.projects.findMany({
        where: inArray(projects.organizationId, orgIds),
        columns: { id: true },
      });

      if (userProjects.length === 0) {
        return { deployments: [], total: 0 };
      }

      const projectIds = userProjects.map((p) => p.id);

      // Get all applications in those projects
      const userApps = await ctx.db.query.applications.findMany({
        where: inArray(applications.projectId, projectIds),
        columns: { id: true },
      });

      const appIds = userApps.map((a) => a.id);

      if (appIds.length === 0) {
        return { deployments: [], total: 0 };
      }

      // Build where conditions
      const conditions: any[] = [inArray(deployments.applicationId, appIds)];

      if (input.status) {
        conditions.push(eq(deployments.status, input.status));
      }

      if (input.applicationId) {
        conditions.push(eq(deployments.applicationId, input.applicationId));
      }

      if (input.timeRange !== "all") {
        const now = new Date();
        const ranges: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };
        const daysAgo = ranges[input.timeRange] || 30;
        const from = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        conditions.push(gte(deployments.createdAt, from));
      }

      const whereClause = and(...conditions);

      // Get total count
      const countResult = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(deployments)
        .where(whereClause);

      const total = Number(countResult[0]?.count || 0);

      // Get deployments with application info
      const results = await ctx.db.query.deployments.findMany({
        where: whereClause,
        orderBy: [desc(deployments.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          application: {
            columns: {
              id: true,
              name: true,
              appName: true,
              branch: true,
              sourceType: true,
            },
            with: {
              project: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      return {
        deployments: results.map((d) => ({
          ...d,
          // Compute duration in seconds
          duration: d.completedAt && d.startedAt
            ? Math.round((new Date(d.completedAt).getTime() - new Date(d.startedAt).getTime()) / 1000)
            : null,
        })),
        total,
      };
    }),

  list: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check if user is a member of the organization
      const member = await ctx.db.query.members.findFirst({
        where: eq(members.organizationId, input.organizationId) && eq(members.userId, ctx.user.id),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this organization",
        });
      }

      const organizationDeployments = await ctx.db.query.deployments.findMany({
        orderBy: [desc(deployments.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          application: {
            columns: {
              id: true,
              name: true,
              appName: true,
            },
            with: {
              project: {
                where: eq(members.organizationId, input.organizationId),
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          database: {
            columns: {
              id: true,
              name: true,
              type: true,
            },
            with: {
              project: {
                where: eq(members.organizationId, input.organizationId),
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      // Filter deployments that belong to projects in the organization
      const filteredDeployments = organizationDeployments.filter(
        (deployment) =>
          (deployment.application?.project) || (deployment.database?.project)
      );

      return filteredDeployments;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.id),
        with: {
          application: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
          database: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Check if user has access
      const hasAccess =
        (deployment.application?.project.organization.members.length ?? 0) > 0 ||
        (deployment.database?.project.organization.members.length ?? 0) > 0;

      if (!hasAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this deployment",
        });
      }

      return deployment;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.id),
        with: {
          application: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
          database: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Check if user has access
      const hasAccess =
        (deployment.application?.project.organization.members.length ?? 0) > 0 ||
        (deployment.database?.project.organization.members.length ?? 0) > 0;

      if (!hasAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this deployment",
        });
      }

      // Only allow canceling pending or running deployments
      if (!["pending", "running"].includes(deployment.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot cancel a deployment that is not pending or running",
        });
      }

      const [updatedDeployment] = await ctx.db
        .update(deployments)
        .set({
          status: "cancelled",
          completedAt: new Date(),
        })
        .where(eq(deployments.id, input.id))
        .returning();

      return updatedDeployment;
    }),

  getLogs: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        type: z.enum(["build", "deployment"]).default("deployment"),
      })
    )
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.id),
        with: {
          application: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
          database: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Check if user has access
      const hasAccess =
        (deployment.application?.project.organization.members.length ?? 0) > 0 ||
        (deployment.database?.project.organization.members.length ?? 0) > 0;

      if (!hasAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this deployment",
        });
      }

      const logs = input.type === "build" ? deployment.buildLogs : deployment.deploymentLogs;

      // Parse logs into structured format
      const structuredLogs = logs
        ? logs.split("\n").map((line, index) => ({
            id: index,
            timestamp: new Date(Date.now() - (1000 - index) * 1000), // Mock timestamps
            level: line.includes("ERROR") ? "error" : line.includes("WARN") ? "warning" : "info",
            message: line,
          }))
        : [];

      return structuredLogs;
    }),

  // Rollback to a previous successful deployment (instant — no rebuild)
  rollback: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch the target deployment (the one to roll back TO)
      const targetDeployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.deploymentId),
        with: {
          application: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!targetDeployment || !targetDeployment.application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Check access
      if (targetDeployment.application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this deployment",
        });
      }

      // Verify the target deployment was completed and has an image tag
      if (targetDeployment.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only rollback to completed deployments",
        });
      }

      if (!targetDeployment.imageTag) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target deployment has no image tag — cannot rollback",
        });
      }

      // Create a new deployment record for the rollback
      const [rollbackDeployment] = await ctx.db
        .insert(deployments)
        .values({
          title: `Rollback to ${targetDeployment.title || targetDeployment.id.slice(0, 8)}`,
          description: `Rolling back to deployment ${targetDeployment.id}`,
          status: "pending",
          applicationId: targetDeployment.applicationId,
          gitCommitSha: targetDeployment.gitCommitSha,
          deploymentType: "rollback",
          triggeredBy: `user:${ctx.user.email}`,
          sourceDeploymentId: targetDeployment.id,
          startedAt: new Date(),
        })
        .returning();

      // Queue the rollback job — it will skip clone+build and use the existing image
      const { deploymentQueue } = await import("../queues/setup");
      await deploymentQueue.add(
        "deploy-application",
        {
          deploymentId: rollbackDeployment.id,
          applicationId: targetDeployment.applicationId,
          userId: ctx.user.id,
          isRollback: true,
          sourceDeploymentId: targetDeployment.id,
        },
        {
          removeOnComplete: 50,
          removeOnFail: 20,
        }
      );

      return rollbackDeployment;
    }),

  retry: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.id),
        with: {
          application: {
            with: {
              project: {
                with: {
                  organization: {
                    with: {
                      members: {
                        where: eq(members.userId, ctx.user.id),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!deployment || !deployment.application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Check if user has access
      if (deployment.application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this deployment",
        });
      }

      // Only allow retrying failed deployments
      if (deployment.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only retry failed deployments",
        });
      }

      // Create a new deployment
      const [newDeployment] = await ctx.db
        .insert(deployments)
        .values({
          title: `Retry: ${deployment.title}`,
          description: `Retrying deployment ${deployment.id}`,
          status: "pending",
          applicationId: deployment.applicationId,
          gitCommitSha: deployment.gitCommitSha,
          startedAt: new Date(),
        })
        .returning();

      // Add to deployment queue
      const { deploymentQueue } = await import("../queues/setup");
      await deploymentQueue.add(
        "deploy-application",
        {
          deploymentId: newDeployment.id,
          applicationId: deployment.applicationId,
          userId: ctx.user.id,
        },
        {
          removeOnComplete: 50,
          removeOnFail: 20,
        }
      );

      return newDeployment;
    }),
});