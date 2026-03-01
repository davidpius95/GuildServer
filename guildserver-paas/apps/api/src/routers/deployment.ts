import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { deployments, applications, databases, members } from "@guildserver/database";
import { eq, desc, or } from "drizzle-orm";

export const deploymentRouter = createTRPCRouter({
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

      // TODO: Add to deployment queue

      return newDeployment;
    }),
});