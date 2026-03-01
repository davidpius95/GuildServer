import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { metrics, applications, members } from "@guildserver/database";
import { eq, and, desc, gte } from "drizzle-orm";

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

      // Generate mock metrics data
      const timeRangeHours = {
        "1h": 1,
        "6h": 6,
        "24h": 24,
        "7d": 168,
      }[input.timeRange];

      const dataPoints = Math.min(timeRangeHours, 100); // Limit data points

      const generateTimeSeries = (baseValue: number, variance: number) =>
        Array.from({ length: dataPoints }, (_, i) => ({
          timestamp: new Date(Date.now() - (dataPoints - 1 - i) * (timeRangeHours * 60 * 60 * 1000) / dataPoints),
          value: Math.max(0, baseValue + (Math.random() - 0.5) * variance),
        }));

      const metricsData = {
        cpu: {
          current: 45.2,
          average: 42.1,
          max: 78.5,
          unit: "%",
          data: generateTimeSeries(45, 30),
        },
        memory: {
          current: 234.5,
          average: 198.7,
          max: 387.2,
          unit: "MB",
          data: generateTimeSeries(200, 150),
        },
        requests: {
          current: 125,
          average: 98,
          max: 234,
          unit: "req/min",
          data: generateTimeSeries(100, 100),
        },
        responseTime: {
          current: 245,
          average: 189,
          max: 1250,
          unit: "ms",
          data: generateTimeSeries(200, 300),
        },
        errorRate: {
          current: 0.5,
          average: 0.8,
          max: 3.2,
          unit: "%",
          data: generateTimeSeries(1, 2),
        },
      };

      return metricsData;
    }),

  getOrganizationMetrics: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        timeRange: z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h"),
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

      // Generate organization-wide metrics
      const timeRangeHours = {
        "1h": 1,
        "6h": 6,
        "24h": 24,
        "7d": 168,
        "30d": 720,
      }[input.timeRange];

      const dataPoints = Math.min(timeRangeHours / 2, 100);

      const generateTimeSeries = (baseValue: number, variance: number) =>
        Array.from({ length: dataPoints }, (_, i) => ({
          timestamp: new Date(Date.now() - (dataPoints - 1 - i) * (timeRangeHours * 60 * 60 * 1000) / dataPoints),
          value: Math.max(0, baseValue + (Math.random() - 0.5) * variance),
        }));

      const organizationMetrics = {
        totalApplications: 12,
        runningApplications: 8,
        totalDeployments: 45,
        successfulDeployments: 42,
        averageResponseTime: {
          current: 234,
          data: generateTimeSeries(230, 100),
        },
        totalRequests: {
          current: 15420,
          data: generateTimeSeries(15000, 5000),
        },
        errorRate: {
          current: 0.8,
          data: generateTimeSeries(1, 1.5),
        },
        resourceUsage: {
          cpu: {
            current: 65.4,
            data: generateTimeSeries(65, 25),
          },
          memory: {
            current: 12.8,
            total: 32,
            data: generateTimeSeries(12, 8),
          },
        },
      };

      return organizationMetrics;
    }),

  getSystemHealth: protectedProcedure
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

      // Mock system health data
      const systemHealth = {
        overall: "healthy", // healthy, warning, critical
        services: [
          {
            name: "API Gateway",
            status: "healthy",
            uptime: "99.9%",
            responseTime: "45ms",
          },
          {
            name: "Database",
            status: "healthy",
            uptime: "99.8%",
            responseTime: "12ms",
          },
          {
            name: "Redis Cache",
            status: "healthy",
            uptime: "100%",
            responseTime: "2ms",
          },
          {
            name: "File Storage",
            status: "warning",
            uptime: "98.5%",
            responseTime: "120ms",
          },
        ],
        alerts: [
          {
            id: "1",
            severity: "warning",
            message: "High memory usage on node-2",
            timestamp: new Date(Date.now() - 300000),
          },
          {
            id: "2",
            severity: "info",
            message: "Scheduled maintenance completed",
            timestamp: new Date(Date.now() - 3600000),
          },
        ],
        uptime: {
          current: "99.7%",
          target: "99.9%",
          data: Array.from({ length: 30 }, (_, i) => ({
            date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000),
            uptime: Math.max(95, 100 - Math.random() * 3),
          })),
        },
      };

      return systemHealth;
    }),

  getAlerts: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        severity: z.enum(["critical", "warning", "info"]).optional(),
        limit: z.number().default(50),
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

      // Mock alerts data
      const mockAlerts = [
        {
          id: "1",
          title: "High CPU Usage",
          description: "Application 'frontend-app' CPU usage above 80%",
          severity: "warning" as const,
          status: "active" as const,
          applicationId: "app-1",
          createdAt: new Date(Date.now() - 300000),
          resolvedAt: null,
        },
        {
          id: "2",
          title: "Database Connection Pool Full",
          description: "PostgreSQL connection pool is at capacity",
          severity: "critical" as const,
          status: "resolved" as const,
          applicationId: null,
          createdAt: new Date(Date.now() - 1800000),
          resolvedAt: new Date(Date.now() - 900000),
        },
        {
          id: "3",
          title: "Deployment Completed",
          description: "Application 'api-service' deployed successfully",
          severity: "info" as const,
          status: "resolved" as const,
          applicationId: "app-2",
          createdAt: new Date(Date.now() - 3600000),
          resolvedAt: new Date(Date.now() - 3600000),
        },
      ];

      const filteredAlerts = input.severity
        ? mockAlerts.filter((alert) => alert.severity === input.severity)
        : mockAlerts;

      return filteredAlerts.slice(0, input.limit);
    }),
});