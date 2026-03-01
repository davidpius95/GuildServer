import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { applications, projects, members, deployments } from "@guildserver/database";
import { eq, and, desc } from "drizzle-orm";
import { deploymentQueue } from "../queues/deployment";

const createApplicationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().uuid(),
  sourceType: z.enum(["github", "gitlab", "bitbucket", "gitea", "docker", "git", "drop"]),
  repository: z.string().optional(),
  branch: z.string().default("main"),
  buildType: z.enum(["dockerfile", "nixpacks", "heroku", "paketo", "static", "railpack"]),
  dockerImage: z.string().optional(),
  dockerTag: z.string().default("latest"),
  environment: z.record(z.string()).default({}),
  memoryLimit: z.number().optional(),
  cpuLimit: z.number().optional(),
  replicas: z.number().default(1),
  autoDeployment: z.boolean().default(false),
});

const updateApplicationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  repository: z.string().optional(),
  branch: z.string().optional(),
  dockerImage: z.string().optional(),
  dockerTag: z.string().optional(),
  environment: z.record(z.string()).optional(),
  memoryLimit: z.number().optional(),
  cpuLimit: z.number().optional(),
  replicas: z.number().optional(),
  autoDeployment: z.boolean().optional(),
});

const deployApplicationSchema = z.object({
  id: z.string().uuid(),
  gitCommitSha: z.string().optional(),
});

export const applicationRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // First, check if user has access to the project
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
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
          code: "FORBIDDEN",
          message: "You don't have access to this project",
        });
      }

      const projectApplications = await ctx.db.query.applications.findMany({
        where: eq(applications.projectId, input.projectId),
        orderBy: [desc(applications.createdAt)],
      });

      return projectApplications;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
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
          deployments: {
            orderBy: [desc(deployments.createdAt)],
            limit: 10,
          },
        },
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      return application;
    }),

  create: protectedProcedure
    .input(createApplicationSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to the project
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
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
          code: "FORBIDDEN",
          message: "You don't have access to this project",
        });
      }

      // Generate app name from name (lowercase, replace spaces with hyphens)
      const appName = input.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

      const [newApplication] = await ctx.db
        .insert(applications)
        .values({
          ...input,
          appName,
          environment: input.environment || {},
        })
        .returning();

      return newApplication;
    }),

  update: protectedProcedure
    .input(updateApplicationSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, id),
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
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      const [updatedApplication] = await ctx.db
        .update(applications)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(applications.id, id))
        .returning();

      return updatedApplication;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
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
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      await ctx.db.delete(applications).where(eq(applications.id, input.id));

      return { success: true };
    }),

  deploy: protectedProcedure
    .input(deployApplicationSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, gitCommitSha } = input;

      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, id),
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
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      // Create deployment record
      const [deployment] = await ctx.db
        .insert(deployments)
        .values({
          title: `Deploy ${application.name}`,
          description: `Deployment triggered by ${ctx.user.name || ctx.user.email}`,
          status: "pending",
          applicationId: id,
          gitCommitSha,
          startedAt: new Date(),
        })
        .returning();

      // Add deployment job to queue
      await deploymentQueue.add(
        "deploy-application",
        {
          deploymentId: deployment.id,
          applicationId: id,
          userId: ctx.user.id,
        },
        {
          removeOnComplete: 50,
          removeOnFail: 20,
        }
      );

      return deployment;
    }),

  getLogs: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        lines: z.number().default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
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
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      // TODO: Implement real log fetching from Docker/Kubernetes
      // For now, return mock logs
      const mockLogs = [
        { timestamp: new Date(), level: "info", message: "Application starting..." },
        { timestamp: new Date(), level: "info", message: "Server listening on port 3000" },
        { timestamp: new Date(), level: "info", message: "Health check passed" },
      ];

      return mockLogs;
    }),

  getMetrics: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        timeRange: z.enum(["1h", "6h", "24h", "7d"]).default("24h"),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
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
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      // TODO: Implement real metrics fetching from monitoring system
      // For now, return mock metrics
      const mockMetrics = {
        cpu: {
          current: 45.5,
          average: 42.3,
          max: 67.8,
          data: Array.from({ length: 24 }, (_, i) => ({
            timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
            value: Math.random() * 70 + 20,
          })),
        },
        memory: {
          current: 234.5,
          average: 198.7,
          max: 387.2,
          data: Array.from({ length: 24 }, (_, i) => ({
            timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
            value: Math.random() * 300 + 150,
          })),
        },
        requests: {
          current: 125,
          average: 98,
          max: 234,
          data: Array.from({ length: 24 }, (_, i) => ({
            timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
            value: Math.floor(Math.random() * 200 + 50),
          })),
        },
      };

      return mockMetrics;
    }),

  restart: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
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
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      // TODO: Implement real application restart
      // For now, just return success
      return { success: true, message: "Application restart initiated" };
    }),

  scale: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        replicas: z.number().min(0).max(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, replicas } = input;

      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, id),
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
      });

      if (!application || application.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      // Update application replicas
      const [updatedApplication] = await ctx.db
        .update(applications)
        .set({
          replicas,
          updatedAt: new Date(),
        })
        .where(eq(applications.id, id))
        .returning();

      // TODO: Implement real scaling logic
      return updatedApplication;
    }),
});