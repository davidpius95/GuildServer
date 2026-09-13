import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { recordAudit } from "../services/audit";
import { createTRPCRouter, protectedProcedure, enforcePlanLimit } from "../trpc/trpc";
import { applications, projects, members, deployments, computeProviders } from "@guildserver/database";
import { eq, and, desc, inArray } from "drizzle-orm";
import { deploymentQueue } from "../queues/deployment";
import {
  restartContainer,
  getContainerLogs,
  getContainerStats,
  getAppContainerInfo,
  removeExistingContainers,
  stopContainer,
  searchDockerHubImages,
  listDockerHubTags,
} from "../services/docker";
import { healthCheck } from "../services/container-manager";
import { listGithubRepos, listGithubBranches } from "../services/git-provider";
import { getProvider } from "../providers/factory";
import type { ComputeProvider } from "../providers/types";
import { registerGithubWebhook } from "../services/github";
import { getValidAccessToken } from "../services/oauth-tokens";
import { encryptSecret } from "../utils/crypto";
import { logger } from "../utils/logger";
import { syncTraefikDynamicDomains } from "../services/traefik-dynamic";

import { runtimeSettingsSchema } from "../services/app-runtime";
import {
  parseHealthCheckConfig,
  parseStopGracePeriod,
  readConfiguredStrategy,
  resolveDeploymentStrategy,
} from "../services/docker/deploy-config";

const createApplicationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().uuid(),
  sourceType: z.enum(["github", "gitlab", "bitbucket", "gitea", "docker", "git", "drop"]),
  repository: z.string().optional(),
  branch: z.string().default("main"),
  buildPath: z.string().optional(), // Subdirectory for monorepo builds
  buildType: z.enum(["dockerfile", "nixpacks", "heroku", "paketo", "static", "railpack"]).optional(),
  dockerImage: z.string().optional(),
  dockerTag: z.string().default("latest"),
  registryUrl: z.string().optional().nullable(),
  registryUsername: z.string().optional().nullable(),
  registryPassword: z.string().optional().nullable(),
  ...runtimeSettingsSchema.shape,
  environment: z.record(z.string()).default({}),
  memoryLimit: z.number().optional(),
  cpuLimit: z.number().optional(),
  replicas: z.number().default(1),
  autoDeployment: z.boolean().default(false),
  deploymentTarget: z.enum(["docker-local", "docker-remote", "proxmox"]).default("docker-local"),
  providerId: z.string().uuid().optional().nullable(),
});

const updateApplicationSchema = z.object({
  ...runtimeSettingsSchema.shape,
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  repository: z.string().optional(),
  branch: z.string().optional(),
  dockerImage: z.string().optional(),
  dockerTag: z.string().optional(),
  registryUrl: z.string().optional().nullable(),
  registryUsername: z.string().optional().nullable(),
  registryPassword: z.string().optional().nullable(),
  environment: z.record(z.string()).optional(),
  memoryLimit: z.number().optional(),
  cpuLimit: z.number().optional(),
  replicas: z.number().optional(),
  autoDeployment: z.boolean().optional(),
  deploymentTarget: z.enum(["docker-local", "docker-remote", "proxmox"]).optional(),
  providerId: z.string().uuid().optional().nullable(),
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

      // Never expose stored registry credentials to the client
      return projectApplications.map(({ registryPassword, ...app }) => app);
    }),

  listByOrg: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user has access to the organization
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

      // Get all projects in the organization
      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.organizationId, input.organizationId),
        columns: { id: true },
      });

      if (orgProjects.length === 0) {
        return [];
      }

      const projectIds = orgProjects.map((p) => p.id);

      const projectApplications = await ctx.db.query.applications.findMany({
        where: inArray(applications.projectId, projectIds),
        orderBy: [desc(applications.createdAt)],
        with: {
          domains: true,
          project: true,
        },
      });

      // Never expose stored registry credentials to the client
      return projectApplications.map(({ registryPassword, ...app }) => app);
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

      // Never expose the stored registry password to the client
      const { registryPassword, ...safeApplication } = application;
      return safeApplication;
    }),

  /**
   * The deploy strategy and health check this application will actually use.
   *
   * Read-only on purpose. The `deployment_strategy`, `health_check_*` and
   * `stop_grace_period` columns are nullable and the resolution has several
   * inputs an operator cannot see from the app row alone — the
   * GS_ZERO_DOWNTIME kill switch, the preview-container rule, the
   * persistent-storage guard, and the domain-based default. Showing the
   * EFFECTIVE answer, with the reason, is what makes "why did my deploy take
   * the old path?" answerable.
   *
   * `configurable: false` in the response means the storage for these settings
   * has not been migrated yet, so the values shown are all derived defaults and
   * a write endpoint would have nowhere to put anything.
   */
  deploymentSettings: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.id),
        with: {
          domains: true,
          project: {
            with: {
              organization: {
                with: { members: { where: eq(members.userId, ctx.user.id) } },
              },
            },
          },
        },
      });

      if (!application || (application.project?.organization?.members?.length ?? 0) === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      const row = application as unknown as Record<string, unknown>;
      const healthCheck = parseHealthCheckConfig(row);
      const decision = resolveDeploymentStrategy({
        configured: readConfiguredStrategy(row),
        hasDomain: (application.domains?.length ?? 0) > 0,
        isPreview: application.appName.includes("-preview-"),
        hasPersistentStorage: !!application.persistentStoragePath,
      });

      return {
        strategy: decision.strategy,
        strategyReason: decision.reason,
        stopGracePeriodSeconds: parseStopGracePeriod(row),
        healthCheck: healthCheck
          ? {
              path: healthCheck.path,
              port: healthCheck.port ?? null,
              intervalSeconds: healthCheck.intervalSeconds,
              timeoutSeconds: healthCheck.timeoutSeconds,
              retries: healthCheck.retries,
              startPeriodSeconds: healthCheck.startPeriodSeconds,
              expectedStatus: healthCheck.expectedStatus,
            }
          : null,
        /** null health check = the platform's built-in reachability probe. */
        healthCheckMode: healthCheck ? ("configured" as const) : ("reachability-probe" as const),
        configurable: "deploymentStrategy" in application || "deployment_strategy" in row,
      };
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

      if (input.persistentStoragePath && (input.deploymentTarget !== "docker-local" || input.providerId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Persistent storage is supported for apps on this server." });
      }
      // Enforce plan limit on applications
      await enforcePlanLimit(project.organization.id, "applications");

      // Generate app name from name (lowercase, replace spaces with hyphens)
      const appName = input.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

      // Auto-resolve deployment target for non-admin users
      let resolvedDeploymentTarget = input.deploymentTarget;
      let resolvedProviderId = input.providerId;

      if (!ctx.isAdmin) {
        // Non-admin users: auto-select the org's default connected provider
        const defaultProvider = await ctx.db.query.computeProviders.findFirst({
          where: and(
            eq(computeProviders.organizationId, project.organization.id),
            eq(computeProviders.isDefault, true),
            eq(computeProviders.status, "connected"),
          ),
        });

        if (defaultProvider) {
          resolvedDeploymentTarget =
            defaultProvider.type === "proxmox" || defaultProvider.type === "docker-remote" ? defaultProvider.type : "docker-local";
          resolvedProviderId = defaultProvider.id;
        } else {
          resolvedDeploymentTarget = "docker-local";
          resolvedProviderId = null;
        }
      }

      if (input.persistentStoragePath && (resolvedDeploymentTarget !== "docker-local" || resolvedProviderId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Persistent storage is supported for apps on this server." });
      }
      const [newApplication] = await ctx.db
        .insert(applications)
        .values({
          ...input,
          appName,
          deploymentTarget: resolvedDeploymentTarget,
          providerId: resolvedProviderId,
          environment: input.environment || {},
          // Convert cpuLimit from number to string (DB column is decimal)
          cpuLimit: input.cpuLimit != null ? String(input.cpuLimit) : undefined,
          // Encrypt the registry password at rest
          registryPassword: encryptSecret(input.registryPassword),
        } as any)
        .returning();

      // Register GitHub Webhook
      if (input.sourceType === "github" && input.repository) {
        try {
          // Through getValidAccessToken so an expired GitHub App token is renewed
          // rather than sent to GitHub and rejected. Failures land in the catch.
          const accessToken = await getValidAccessToken(ctx.user.id, "github");

          if (accessToken) {
            // Determine the API base URL from env
            const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_URL || "https://api.guild-technologies.com";
            // Check if it's the traefik setup where webhook route is on main domain under /api?
            // Actually, /webhooks is at the root of the api container. 
            // The Traefik rule for webhooks should be under the BASE_DOMAIN, for example https://guild-technologies.com/webhooks/github
            const webhookUrl = `${baseUrl}/webhooks/github`;
            const secret = process.env.GITHUB_WEBHOOK_SECRET || "guildserver-webhook-secret-default";
            
            await registerGithubWebhook(input.repository, accessToken, webhookUrl, secret);
          }
        } catch (error) {
          console.warn("Failed to register webhook during app creation:", error);
        }
      }

      const { registryPassword: _pw, ...safeApplication } = newApplication;
      return safeApplication;
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

      if ((updates.persistentStoragePath ?? application.persistentStoragePath) &&
          ((updates.deploymentTarget ?? application.deploymentTarget ?? "docker-local") !== "docker-local" || (updates.providerId ?? application.providerId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Persistent storage is supported for apps on this server." });
      }

      // Only re-encrypt the registry password when the client actually sent one;
      // leave the stored value untouched otherwise.
      const encryptedUpdates =
        updates.registryPassword !== undefined
          ? { ...updates, registryPassword: encryptSecret(updates.registryPassword) }
          : updates;
      const { cpuLimit, ...otherUpdates } = encryptedUpdates;

      const [updatedApplication] = await ctx.db
        .update(applications)
        .set({
          ...otherUpdates,
          ...(cpuLimit !== undefined ? { cpuLimit: String(cpuLimit) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(applications.id, id))
        .returning();

      // Register GitHub Webhook if repository was updated
      if (updates.repository && updatedApplication.sourceType === "github") {
        try {
          // Through getValidAccessToken so an expired GitHub App token is renewed
          // rather than sent to GitHub and rejected. Failures land in the catch.
          const accessToken = await getValidAccessToken(ctx.user.id, "github");

          if (accessToken) {
            const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_URL || "https://api.guild-technologies.com";
            const webhookUrl = `${baseUrl}/webhooks/github`;
            const secret = process.env.GITHUB_WEBHOOK_SECRET || "guildserver-webhook-secret-default";
            
            await registerGithubWebhook(updates.repository, accessToken, webhookUrl, secret);
          }
        } catch (error) {
          console.warn("Failed to register webhook during app update:", error);
        }
      }

      const { registryPassword: _pw, ...safeApplication } = updatedApplication;
      return safeApplication;
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

      // Clean up containers based on deployment target
      if (application.providerId && application.deploymentTarget !== "docker-local") {
        // Provider-deployed app (Proxmox LXC, remote Docker host): remove it there
        try {
          const provider = await getProvider(application.providerId);
          await provider.remove(input.id);
        } catch (error: any) {
          console.warn(`Failed to clean up provider workload for app ${input.id}: ${error.message}`);
        }
      } else {
        // Docker-local: remove local Docker containers
        try {
          await removeExistingContainers(input.id);
        } catch (error: any) {
          console.warn(`Failed to clean up containers for app ${input.id}: ${error.message}`);
        }
      }

      await ctx.db.delete(applications).where(eq(applications.id, input.id));
      void syncTraefikDynamicDomains();

      if (!ctx.apiToken) {
        await recordAudit(
          {
            userId: ctx.user.id,
            organizationId: application.project.organization.id,
            action: "application.deleted",
            resourceType: "application",
            resourceId: application.id,
            resourceName: application.name,
            metadata: { projectId: application.projectId, deploymentTarget: application.deploymentTarget },
          },
          ctx.req,
        );
      }

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

      if (!ctx.apiToken) {
        await recordAudit(
          {
            userId: ctx.user.id,
            organizationId: application.project.organization.id,
            action: "application.deployed",
            resourceType: "application",
            resourceId: application.id,
            resourceName: application.name,
            metadata: { deploymentId: deployment.id, gitCommitSha: gitCommitSha ?? null },
          },
          ctx.req,
        );
      }

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

      // Fetch real logs from wherever the workload runs
      try {
        const rawLogs = application.providerId && application.deploymentTarget !== "docker-local"
          ? await (await getProvider(application.providerId)).getLogs(input.id, input.lines)
          : await getContainerLogs(input.id, input.lines);

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
        // The raw error was returned verbatim, and it carries internal detail —
        // Docker socket paths, hostnames, stack fragments. Keep that in the
        // server log and tell the caller only what they can act on.
        logger.warn("Failed to fetch container logs", { applicationId: input.id, error: String(error?.message ?? error) });
        return [{ timestamp: new Date(), level: "error", message: "Failed to fetch logs. The container may not be running." }];
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

      // Provider-backed apps (remote Docker, Proxmox) are measured where they run.
      if (application.providerId && application.deploymentTarget !== "docker-local") {
        let providerMetrics: Awaited<ReturnType<ComputeProvider["getMetrics"]>> = null;
        let providerInfo: Awaited<ReturnType<ComputeProvider["getInfo"]>> = null;
        let providerHealth: Awaited<ReturnType<ComputeProvider["healthCheck"]>> | null = null;
        try {
          const provider = await getProvider(application.providerId);
          [providerMetrics, providerInfo, providerHealth] = await Promise.all([
            provider.getMetrics(input.id),
            provider.getInfo(input.id),
            provider.healthCheck(input.id),
          ]);
        } catch (error: any) {
          logger.warn("Failed to fetch provider metrics", { applicationId: input.id, error: String(error?.message ?? error) });
        }
        const status = providerHealth?.status ?? "unknown";
        if (!providerMetrics) {
          return {
            status,
            container: providerInfo,
            cpu: { current: 0, average: 0, max: 0, data: [] },
            memory: { current: 0, average: 0, max: 0, data: [] },
            network: { rxBytes: 0, txBytes: 0 },
          };
        }
        return {
          status,
          container: providerInfo,
          cpu: {
            current: providerMetrics.cpuPercent,
            average: providerMetrics.cpuPercent,
            max: providerMetrics.cpuPercent,
            data: [{ timestamp: new Date(), value: providerMetrics.cpuPercent }],
          },
          memory: {
            current: providerMetrics.memoryUsageMb,
            average: providerMetrics.memoryUsageMb,
            max: providerMetrics.memoryLimitMb,
            percent: providerMetrics.memoryPercent,
            data: [{ timestamp: new Date(), value: providerMetrics.memoryUsageMb }],
          },
          network: { rxBytes: providerMetrics.networkRxBytes, txBytes: providerMetrics.networkTxBytes },
        };
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

      // Restart container (Proxmox or Docker-local)
      let restarted: boolean;
      if (application.providerId && application.deploymentTarget !== "docker-local") {
        const provider = await getProvider(application.providerId);
        restarted = await provider.restart(input.id);
      } else {
        restarted = await restartContainer(input.id);
      }
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

  /**
   * Stop the application's running container without changing its replica
   * count, so a later deploy or restart brings it back as configured.
   *
   * Added for POST /api/v1/applications/:id/stop. The REST layer must delegate
   * authorization to a tRPC procedure rather than reimplement it, and until now
   * the only way to stop an app was scale({ replicas: 0 }), which also persists
   * replicas = 0: a configuration write a deploy-scoped token must not make.
   * Authorization is the same membership walk as restart.
   */
  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
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

      if (!application || (application.project?.organization?.members?.length ?? 0) === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found or access denied",
        });
      }

      let stopped: boolean;
      if (application.providerId && application.deploymentTarget !== "docker-local") {
        const provider = await getProvider(application.providerId);
        await provider.stop(input.id);
        stopped = true;
      } else {
        stopped = await stopContainer(input.id);
      }
      if (!stopped) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No running container found for this application.",
        });
      }

      await ctx.db
        .update(applications)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(applications.id, input.id));

      return { success: true, message: "Application stopped successfully" };
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
          if (application.providerId && application.deploymentTarget !== "docker-local") {
            // Provider-deployed app: stop it where it runs
            const provider = await getProvider(application.providerId);
            await provider.stop(id);
          } else {
            // Docker-local: stop local Docker container
            await stopContainer(id);
          }
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

  // Docker Hub image discovery
  searchDockerImages: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(25),
      })
    )
    .query(async ({ input }) => {
      return await searchDockerHubImages(input.query, input.page, input.pageSize);
    }),

  listDockerImageTags: protectedProcedure
    .input(z.object({ repository: z.string().min(1) }))
    .query(async ({ input }) => {
      return await listDockerHubTags(input.repository);
    }),
});
