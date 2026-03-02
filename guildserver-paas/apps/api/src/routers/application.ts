import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { applications, projects, members, deployments } from "@guildserver/database";
import { eq, and, desc } from "drizzle-orm";
import { deploymentQueue } from "../queues/deployment";
import {
  restartContainer,
  getContainerLogs,
  getContainerStats,
  getAppContainerInfo,
  removeExistingContainers,
  stopContainer,
} from "../services/docker";
import { healthCheck } from "../services/container-manager";
import { listGithubRepos, listGithubBranches } from "../services/git-provider";

const createApplicationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().uuid(),
  sourceType: z.enum(["github", "gitlab", "bitbucket", "gitea", "docker", "git", "drop"]),
  repository: z.string().optional(),
  branch: z.string().default("main"),
  buildPath: z.string().optional(), // Subdirectory for monorepo builds
  buildType: z.enum(["dockerfile", "nixpacks", "heroku", "paketo", "static", "railpack"]),
  dockerImage: z.string().optional(),
  dockerTag: z.string().default("latest"),
  containerPort: z.number().optional(),
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
        with: {
          domains: true,
        },
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

  // Toggle preview deployments and update main branch
  updatePreviewSettings: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        previewDeployments: z.boolean(),
        mainBranch: z.string().optional(),
        previewTtlHours: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
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

      if (!app) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
      }

      if (app.project.organization.members.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      const updateData: any = {
        previewDeployments: input.previewDeployments,
        updatedAt: new Date(),
      };
      if (input.mainBranch) updateData.mainBranch = input.mainBranch;
      if (input.previewTtlHours) updateData.previewTtlHours = input.previewTtlHours;

      const [updated] = await ctx.db
        .update(applications)
        .set(updateData)
        .where(eq(applications.id, input.id))
        .returning();

      return updated;
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

      // Stop and remove Docker containers for this application
      try {
        await removeExistingContainers(input.id);
      } catch (error: any) {
        // Log but don't block deletion if container cleanup fails
        console.warn(`Failed to clean up containers for app ${input.id}: ${error.message}`);
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

      // Fetch real logs from Docker container
      try {
        const rawLogs = await getContainerLogs(input.id, input.lines);

        if (rawLogs.length === 0) {
          return [{ timestamp: new Date(), level: "info", message: "No logs available. Container may not be running." }];
        }

        return rawLogs.map((line, index) => {
          // Try to parse timestamp from Docker log format
          const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)/);
          const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();
          const message = timestampMatch ? timestampMatch[2] : line;
          const level = message.toLowerCase().includes("error") ? "error"
            : message.toLowerCase().includes("warn") ? "warning"
            : "info";

          return { timestamp, level, message };
        });
      } catch (error: any) {
        return [{ timestamp: new Date(), level: "error", message: `Failed to fetch logs: ${error.message}` }];
      }
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

      // Fetch real metrics from Docker container stats
      const stats = await getContainerStats(input.id);
      const containerInfo = await getAppContainerInfo(input.id);
      const health = await healthCheck(input.id);

      if (!stats) {
        // Container not running - return empty metrics with status info
        return {
          status: health.status,
          container: containerInfo,
          cpu: { current: 0, average: 0, max: 0, data: [] },
          memory: { current: 0, average: 0, max: 0, data: [] },
          network: { rxBytes: 0, txBytes: 0 },
        };
      }

      return {
        status: health.status,
        uptime: health.uptime,
        container: containerInfo,
        cpu: {
          current: stats.cpuPercent,
          average: stats.cpuPercent,
          max: stats.cpuPercent,
          data: [{ timestamp: new Date(), value: stats.cpuPercent }],
        },
        memory: {
          current: stats.memoryUsageMb,
          average: stats.memoryUsageMb,
          max: stats.memoryLimitMb,
          percent: stats.memoryPercent,
          data: [{ timestamp: new Date(), value: stats.memoryUsageMb }],
        },
        network: {
          rxBytes: stats.networkRxBytes,
          txBytes: stats.networkTxBytes,
        },
      };
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

      // Restart Docker container
      const restarted = await restartContainer(input.id);
      if (!restarted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No running container found for this application. Deploy it first.",
        });
      }

      // Update application status
      await ctx.db
        .update(applications)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(applications.id, input.id));

      return { success: true, message: "Application restarted successfully" };
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

      // Handle scaling: if scaled to 0, stop the container
      if (replicas === 0) {
        try {
          await stopContainer(id);
          await ctx.db
            .update(applications)
            .set({ status: "stopped", updatedAt: new Date() })
            .where(eq(applications.id, id));
        } catch {
          // Container may not exist
        }
      }

      return updatedApplication;
    }),

  // Git integration endpoints
  listGithubRepos: protectedProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      return await listGithubRepos(input.token);
    }),

  listGithubBranches: protectedProcedure
    .input(z.object({ token: z.string(), owner: z.string(), repo: z.string() }))
    .query(async ({ input }) => {
      return await listGithubBranches(input.token, input.owner, input.repo);
    }),
});