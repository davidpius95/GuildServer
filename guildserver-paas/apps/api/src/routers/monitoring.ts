import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { metrics, applications, members, deployments, projects } from "@guildserver/database";
import { eq, and, desc, gte, count, sql, inArray } from "drizzle-orm";
import {
  collectAllMetrics,
  getContainerSummary,
  healthCheck,
} from "../services/container-manager";
import { getContainerStats, testDockerConnection } from "../services/docker";
import { getConnectedClients } from "../websocket/server";

// =====================
// Shared helpers
// =====================

/** Run async tasks with bounded concurrency (default 3) */
async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 3
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Get org applications via efficient SQL subquery (not fetch-all + filter) */
async function getOrgApplications(db: any, organizationId: string) {
  // Use subquery: SELECT apps WHERE project_id IN (SELECT id FROM projects WHERE org_id = ?)
  const orgProjectIds = await db.query.projects.findMany({
    where: eq(projects.organizationId, organizationId),
    columns: { id: true },
  });

  if (orgProjectIds.length === 0) return [];

  const projectIds = orgProjectIds.map((p: any) => p.id);
  return db.query.applications.findMany({
    where: inArray(applications.projectId, projectIds),
  });
}

/** Verify user is org member, throws FORBIDDEN if not */
async function verifyOrgMembership(db: any, organizationId: string, userId: string) {
  const member = await db.query.members.findFirst({
    where: and(
      eq(members.organizationId, organizationId),
      eq(members.userId, userId)
    ),
  });
  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have access to this organization",
    });
  }
  return member;
}

const recordMetricSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["counter", "gauge", "histogram"]),
  value: z.number(),
  labels: z.record(z.string()).default({}),
  applicationId: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
});

const getMetricsSchema = z.object({
  organizationId: z.string().uuid(),
  applicationId: z.string().uuid().optional(),
  metricName: z.string().optional(),
  timeRange: z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h"),
  limit: z.number().default(1000),
});

export const monitoringRouter = createTRPCRouter({
  recordMetric: protectedProcedure
    .input(recordMetricSchema)
    .mutation(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.db, input.organizationId, ctx.user.id);

      const [metric] = await ctx.db
        .insert(metrics)
        .values({
          name: input.name,
          type: input.type,
          value: input.value.toString(),
          labels: input.labels,
          applicationId: input.applicationId,
          organizationId: input.organizationId,
          timestamp: new Date(),
        })
        .returning();

      return metric;
    }),

  getMetrics: protectedProcedure
    .input(getMetricsSchema)
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.db, input.organizationId, ctx.user.id);

      // Calculate time range
      const timeRangeMs = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };

      const startTime = new Date(Date.now() - timeRangeMs[input.timeRange]);

      let whereClause = and(
        eq(metrics.organizationId, input.organizationId),
        gte(metrics.timestamp, startTime)
      );

      if (input.applicationId) {
        whereClause = and(whereClause, eq(metrics.applicationId, input.applicationId));
      }

      if (input.metricName) {
        whereClause = and(whereClause, eq(metrics.name, input.metricName));
      }

      const metricsData = await ctx.db.query.metrics.findMany({
        where: whereClause,
        orderBy: [desc(metrics.timestamp)],
        limit: input.limit,
        with: {
          application: {
            columns: {
              id: true,
              name: true,
              appName: true,
            },
          },
        },
      });

      return metricsData;
    }),

  /**
   * Get REAL application metrics - from DB stored metrics + live Docker stats
   */
  getApplicationMetrics: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        timeRange: z.enum(["1h", "6h", "24h", "7d"]).default("24h"),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check if user has access to the application
      const application = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
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

      const timeRangeMs = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
      };

      const startTime = new Date(Date.now() - timeRangeMs[input.timeRange]);

      // Fetch all metric types in parallel (4 queries, all indexed)
      const [cpuMetrics, memoryMetrics, networkRxMetrics, networkTxMetrics, liveStats] = await Promise.all([
        ctx.db.query.metrics.findMany({
          where: and(
            eq(metrics.applicationId, input.applicationId),
            eq(metrics.name, "cpu_percent"),
            gte(metrics.timestamp, startTime)
          ),
          orderBy: [desc(metrics.timestamp)],
          limit: 500,
        }),
        ctx.db.query.metrics.findMany({
          where: and(
            eq(metrics.applicationId, input.applicationId),
            eq(metrics.name, "memory_usage_mb"),
            gte(metrics.timestamp, startTime)
          ),
          orderBy: [desc(metrics.timestamp)],
          limit: 500,
        }),
        ctx.db.query.metrics.findMany({
          where: and(
            eq(metrics.applicationId, input.applicationId),
            eq(metrics.name, "network_rx_bytes"),
            gte(metrics.timestamp, startTime)
          ),
          orderBy: [desc(metrics.timestamp)],
          limit: 500,
        }),
        ctx.db.query.metrics.findMany({
          where: and(
            eq(metrics.applicationId, input.applicationId),
            eq(metrics.name, "network_tx_bytes"),
            gte(metrics.timestamp, startTime)
          ),
          orderBy: [desc(metrics.timestamp)],
          limit: 500,
        }),
        // Also fetch live Docker stats in parallel
        getContainerStats(input.applicationId),
      ]);

      // Calculate aggregates from stored data
      const cpuValues = cpuMetrics.map((m) => parseFloat(m.value));
      const memValues = memoryMetrics.map((m) => parseFloat(m.value));

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;

      return {
        cpu: {
          current: liveStats?.cpuPercent ?? (cpuValues[0] || 0),
          average: Math.round(avg(cpuValues) * 100) / 100,
          max: Math.round(max(cpuValues) * 100) / 100,
          unit: "%",
          data: cpuMetrics.reverse().map((m) => ({
            timestamp: m.timestamp,
            value: parseFloat(m.value),
          })),
        },
        memory: {
          current: liveStats?.memoryUsageMb ?? (memValues[0] || 0),
          average: Math.round(avg(memValues) * 100) / 100,
          max: Math.round(max(memValues) * 100) / 100,
          unit: "MB",
          data: memoryMetrics.reverse().map((m) => ({
            timestamp: m.timestamp,
            value: parseFloat(m.value),
          })),
        },
        network: {
          rxBytes: liveStats?.networkRxBytes ?? 0,
          txBytes: liveStats?.networkTxBytes ?? 0,
          rxData: networkRxMetrics.reverse().map((m) => ({
            timestamp: m.timestamp,
            value: parseFloat(m.value),
          })),
          txData: networkTxMetrics.reverse().map((m) => ({
            timestamp: m.timestamp,
            value: parseFloat(m.value),
          })),
        },
      };
    }),

  /**
   * Get REAL organization-wide metrics
   * OPTIMIZED: Uses SQL subquery instead of fetch-all + filter
   */
  getOrganizationMetrics: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        timeRange: z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h"),
      })
    )
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.db, input.organizationId, ctx.user.id);

      // Get org apps via efficient subquery (NOT fetch-all + filter)
      const orgApps = await getOrgApplications(ctx.db, input.organizationId);
      const orgAppIds = orgApps.map((a: any) => a.id);

      const totalApplications = orgApps.length;
      const runningApplications = orgApps.filter((a: any) => a.status === "running").length;

      // Count deployments efficiently using SQL with IN clause
      let totalDeployments = 0;
      let successfulDeployments = 0;

      if (orgAppIds.length > 0) {
        const deploymentCounts = await ctx.db
          .select({
            total: count(),
            successful: count(
              sql`CASE WHEN ${deployments.status} = 'completed' THEN 1 END`
            ),
          })
          .from(deployments)
          .where(inArray(deployments.applicationId, orgAppIds));

        totalDeployments = deploymentCounts[0]?.total ?? 0;
        successfulDeployments = Number(deploymentCounts[0]?.successful ?? 0);
      }

      // Get live metrics from Docker (already efficiently batched in collectAllMetrics)
      const liveMetrics = await collectAllMetrics();
      const orgLiveMetrics = liveMetrics.filter((m) =>
        orgAppIds.includes(m.applicationId)
      );

      // Aggregate CPU and memory across all apps
      const totalCpu = orgLiveMetrics.reduce((sum, m) => sum + m.stats.cpuPercent, 0);
      const totalMemory = orgLiveMetrics.reduce((sum, m) => sum + m.stats.memoryUsageMb, 0);
      const totalMemoryLimit = orgLiveMetrics.reduce((sum, m) => sum + m.stats.memoryLimitMb, 0);

      // Get historical data points for charts
      const timeRangeMs = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };

      const startTime = new Date(Date.now() - timeRangeMs[input.timeRange]);

      // Fetch CPU + memory history in parallel (both use composite index)
      const [cpuHistory, memoryHistory] = await Promise.all([
        ctx.db.query.metrics.findMany({
          where: and(
            eq(metrics.organizationId, input.organizationId),
            eq(metrics.name, "cpu_percent"),
            gte(metrics.timestamp, startTime)
          ),
          orderBy: [desc(metrics.timestamp)],
          limit: 500,
        }),
        ctx.db.query.metrics.findMany({
          where: and(
            eq(metrics.organizationId, input.organizationId),
            eq(metrics.name, "memory_usage_mb"),
            gte(metrics.timestamp, startTime)
          ),
          orderBy: [desc(metrics.timestamp)],
          limit: 500,
        }),
      ]);

      return {
        totalApplications,
        runningApplications,
        totalDeployments,
        successfulDeployments,
        resourceUsage: {
          cpu: {
            current: Math.round(totalCpu * 100) / 100,
            data: cpuHistory.reverse().map((m) => ({
              timestamp: m.timestamp,
              value: parseFloat(m.value),
            })),
          },
          memory: {
            current: Math.round(totalMemory * 100) / 100,
            total: Math.round(totalMemoryLimit / 1024 * 100) / 100, // GB
            data: memoryHistory.reverse().map((m) => ({
              timestamp: m.timestamp,
              value: parseFloat(m.value),
            })),
          },
        },
      };
    }),

  /**
   * Get REAL system health from Docker
   * OPTIMIZED: Uses SQL subquery + bounded Docker concurrency
   */
  getSystemHealth: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.db, input.organizationId, ctx.user.id);

      // Run infrastructure checks + app query in parallel
      const [dockerOk, containerSummary, wsClients, orgApps] = await Promise.all([
        testDockerConnection(),
        getContainerSummary(),
        Promise.resolve(getConnectedClients()),
        getOrgApplications(ctx.db, input.organizationId),
      ]);

      // Health-check org apps with bounded concurrency (max 3 parallel Docker calls)
      const appHealthChecks = await pMap(
        orgApps,
        async (app: any) => {
          const health = await healthCheck(app.id);
          return {
            applicationId: app.id,
            name: app.name,
            appName: app.appName,
            ...health,
          };
        },
        3
      );

      const healthyApps = appHealthChecks.filter((h) => h.healthy).length;
      const unhealthyApps = appHealthChecks.filter((h) => !h.healthy && h.status !== "not_found").length;

      // Determine overall health
      let overall: "healthy" | "warning" | "critical" = "healthy";
      if (!dockerOk) overall = "critical";
      else if (unhealthyApps > 0) overall = "warning";
      else if (containerSummary.errored > 0) overall = "warning";

      const services = [
        {
          name: "Docker Engine",
          status: dockerOk ? "healthy" : "critical",
          uptime: dockerOk ? "Available" : "Unavailable",
          responseTime: dockerOk ? "<1ms" : "N/A",
        },
        {
          name: "API Server",
          status: "healthy" as const,
          uptime: "Running",
          responseTime: "<5ms",
        },
        {
          name: "WebSocket",
          status: "healthy" as const,
          uptime: `${wsClients.total} client(s)`,
          responseTime: "<1ms",
        },
        {
          name: "Containers",
          status: containerSummary.errored > 0 ? "warning" : "healthy",
          uptime: `${containerSummary.running}/${containerSummary.total} running`,
          responseTime: "N/A",
        },
      ];

      return {
        overall,
        services,
        applications: appHealthChecks,
        containers: containerSummary,
        alerts: [],
      };
    }),

  /**
   * Get alerts based on real conditions
   * OPTIMIZED: Uses SQL subquery + bounded Docker concurrency
   */
  getAlerts: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        severity: z.enum(["critical", "warning", "info"]).optional(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.db, input.organizationId, ctx.user.id);

      const alerts: Array<{
        id: string;
        title: string;
        description: string;
        severity: "critical" | "warning" | "info";
        status: "active" | "resolved";
        applicationId: string | null;
        createdAt: Date;
        resolvedAt: Date | null;
      }> = [];

      // Get org apps via efficient subquery (NOT fetch-all + filter)
      const [orgApps, dockerOk] = await Promise.all([
        getOrgApplications(ctx.db, input.organizationId),
        testDockerConnection(),
      ]);

      // Health-check + stats with bounded concurrency (max 3 parallel Docker calls)
      const appChecks = await pMap(
        orgApps,
        async (app: any) => {
          const health = await healthCheck(app.id);
          // Only fetch stats if healthy (avoid wasted Docker calls)
          const stats = health.healthy ? await getContainerStats(app.id) : null;
          return { app, health, stats };
        },
        3
      );

      // Generate alerts from results
      for (const { app, health, stats } of appChecks) {
        if (app.status === "running" && !health.healthy) {
          alerts.push({
            id: `health-${app.id}`,
            title: "Container Unhealthy",
            description: `Application '${app.name}' container is ${health.status}`,
            severity: "critical",
            status: "active",
            applicationId: app.id,
            createdAt: new Date(),
            resolvedAt: null,
          });
        }

        if (app.status === "failed") {
          alerts.push({
            id: `failed-${app.id}`,
            title: "Deployment Failed",
            description: `Application '${app.name}' last deployment failed`,
            severity: "warning",
            status: "active",
            applicationId: app.id,
            createdAt: app.updatedAt || new Date(),
            resolvedAt: null,
          });
        }

        if (stats && stats.cpuPercent > 80) {
          alerts.push({
            id: `cpu-${app.id}`,
            title: "High CPU Usage",
            description: `Application '${app.name}' CPU at ${stats.cpuPercent.toFixed(1)}%`,
            severity: "warning",
            status: "active",
            applicationId: app.id,
            createdAt: new Date(),
            resolvedAt: null,
          });
        }
        if (stats && stats.memoryPercent > 85) {
          alerts.push({
            id: `memory-${app.id}`,
            title: "High Memory Usage",
            description: `Application '${app.name}' memory at ${stats.memoryPercent.toFixed(1)}%`,
            severity: "warning",
            status: "active",
            applicationId: app.id,
            createdAt: new Date(),
            resolvedAt: null,
          });
        }
      }

      if (!dockerOk) {
        alerts.push({
          id: "docker-down",
          title: "Docker Engine Unavailable",
          description: "Docker daemon is not responding. Deployments will fail.",
          severity: "critical",
          status: "active",
          applicationId: null,
          createdAt: new Date(),
          resolvedAt: null,
        });
      }

      // Filter by severity if requested
      const filteredAlerts = input.severity
        ? alerts.filter((alert) => alert.severity === input.severity)
        : alerts;

      return filteredAlerts.slice(0, input.limit);
    }),

  /**
   * Get per-application health + metrics summary for the monitoring dashboard
   * OPTIMIZED: Uses SQL subquery + bounded Docker concurrency
   */
  getApplicationsSummary: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.db, input.organizationId, ctx.user.id);

      // Get org apps via efficient subquery (NOT fetch-all + filter)
      const orgApps = await getOrgApplications(ctx.db, input.organizationId);

      // Health-check + stats with bounded concurrency (max 3 parallel Docker calls)
      const results = await pMap(
        orgApps,
        async (app: any) => {
          const health = await healthCheck(app.id);
          const stats = health.healthy ? await getContainerStats(app.id) : null;

          return {
            id: app.id,
            name: app.name,
            appName: app.appName,
            status: app.status,
            healthy: health.healthy,
            uptime: health.uptime,
            cpu: stats?.cpuPercent ?? 0,
            memory: stats?.memoryUsageMb ?? 0,
            memoryPercent: stats?.memoryPercent ?? 0,
            networkRx: stats?.networkRxBytes ?? 0,
            networkTx: stats?.networkTxBytes ?? 0,
          };
        },
        3
      );

      return results;
    }),
});
