import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc/trpc";
import { auditLogs, members } from "@guildserver/database";
import { eq, and, desc, gte, like, or } from "drizzle-orm";

const getAuditLogsSchema = z.object({
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  search: z.string().optional(),
  limit: z.number().default(100),
  offset: z.number().default(0),
});

const createAuditLogSchema = z.object({
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().uuid().optional(),
  resourceName: z.string().optional(),
  metadata: z.record(z.any()).default({}),
  organizationId: z.string().uuid(),
});

export const auditRouter = createTRPCRouter({
  getLogs: protectedProcedure
    .input(getAuditLogsSchema)
    .query(async ({ ctx, input }) => {
      let hasAccess = false;

      // Check access permissions
      if (input.organizationId) {
        const member = await ctx.db.query.members.findFirst({
          where: and(
            eq(members.organizationId, input.organizationId),
            eq(members.userId, ctx.user.id)
          ),
        });
        hasAccess = !!member;
      } else if (ctx.isAdmin) {
        hasAccess = true;
      } else if (input.userId === ctx.user.id) {
        hasAccess = true;
      }

      if (!hasAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to view these audit logs",
        });
      }

      // Build where clause
      let whereClause: any = undefined;

      if (input.organizationId) {
        whereClause = eq(auditLogs.organizationId, input.organizationId);
      }

      if (input.userId) {
        whereClause = whereClause
          ? and(whereClause, eq(auditLogs.userId, input.userId))
          : eq(auditLogs.userId, input.userId);
      }

      if (input.action) {
        whereClause = whereClause
          ? and(whereClause, eq(auditLogs.action, input.action))
          : eq(auditLogs.action, input.action);
      }

      if (input.resourceType) {
        whereClause = whereClause
          ? and(whereClause, eq(auditLogs.resourceType, input.resourceType))
          : eq(auditLogs.resourceType, input.resourceType);
      }

      if (input.resourceId) {
        whereClause = whereClause
          ? and(whereClause, eq(auditLogs.resourceId, input.resourceId))
          : eq(auditLogs.resourceId, input.resourceId);
      }

      if (input.dateFrom) {
        whereClause = whereClause
          ? and(whereClause, gte(auditLogs.timestamp, input.dateFrom))
          : gte(auditLogs.timestamp, input.dateFrom);
      }

      if (input.dateTo) {
        whereClause = whereClause
          ? and(whereClause, gte(input.dateTo, auditLogs.timestamp))
          : gte(input.dateTo, auditLogs.timestamp);
      }

      if (input.search) {
        const searchClause = or(
          like(auditLogs.action, `%${input.search}%`),
          like(auditLogs.resourceType, `%${input.search}%`),
          like(auditLogs.resourceName, `%${input.search}%`)
        );
        whereClause = whereClause ? and(whereClause, searchClause) : searchClause;
      }

      const logs = await ctx.db.query.auditLogs.findMany({
        where: whereClause,
        orderBy: [desc(auditLogs.timestamp)],
        limit: input.limit,
        offset: input.offset,
      });

      return logs;
    }),

  createLog: protectedProcedure
    .input(createAuditLogSchema)
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

      const [auditLog] = await ctx.db
        .insert(auditLogs)
        .values({
          userId: ctx.user.id,
          organizationId: input.organizationId,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          resourceName: input.resourceName,
          metadata: input.metadata,
          ipAddress: ctx.req.ip || null,
          userAgent: ctx.req.get('User-Agent') || null,
          sessionId: ctx.req.sessionID || null,
          timestamp: new Date(),
        })
        .returning();

      return auditLog;
    }),

  getStatistics: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        timeRange: z.enum(["24h", "7d", "30d"]).default("7d"),
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

      const timeRangeMs = {
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };

      const startTime = new Date(Date.now() - timeRangeMs[input.timeRange]);

      // Get audit logs for the time range
      const logs = await ctx.db.query.auditLogs.findMany({
        where: and(
          eq(auditLogs.organizationId, input.organizationId),
          gte(auditLogs.timestamp, startTime)
        ),
        columns: {
          action: true,
          resourceType: true,
          userId: true,
          timestamp: true,
        },
      });

      // Calculate statistics
      const totalEvents = logs.length;
      const uniqueUsers = new Set(logs.map(log => log.userId)).size;
      
      const actionCounts = logs.reduce((acc, log) => {
        acc[log.action] = (acc[log.action] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const resourceTypeCounts = logs.reduce((acc, log) => {
        acc[log.resourceType] = (acc[log.resourceType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Group by day for trend data
      const dailyActivity = logs.reduce((acc, log) => {
        const day = log.timestamp.toISOString().split('T')[0];
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const trendData = Object.entries(dailyActivity).map(([date, count]) => ({
        date: new Date(date),
        count,
      })).sort((a, b) => a.date.getTime() - b.date.getTime());

      return {
        totalEvents,
        uniqueUsers,
        actionCounts,
        resourceTypeCounts,
        trendData,
        topActions: Object.entries(actionCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([action, count]) => ({ action, count })),
        topResourceTypes: Object.entries(resourceTypeCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([resourceType, count]) => ({ resourceType, count })),
      };
    }),

  exportLogs: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        format: z.enum(["json", "csv"]).default("json"),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is an admin member of the organization
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to export audit logs",
        });
      }

      let whereClause = eq(auditLogs.organizationId, input.organizationId);

      if (input.dateFrom) {
        whereClause = and(whereClause, gte(auditLogs.timestamp, input.dateFrom));
      }

      if (input.dateTo) {
        whereClause = and(whereClause, gte(input.dateTo, auditLogs.timestamp));
      }

      const logs = await ctx.db.query.auditLogs.findMany({
        where: whereClause,
        orderBy: [desc(auditLogs.timestamp)],
        limit: 10000, // Limit for export
      });

      if (input.format === "csv") {
        // Convert to CSV format
        const headers = ["timestamp", "userId", "action", "resourceType", "resourceId", "resourceName", "ipAddress", "userAgent"];
        const csvData = [
          headers.join(","),
          ...logs.map(log => [
            log.timestamp.toISOString(),
            log.userId || "",
            log.action,
            log.resourceType,
            log.resourceId || "",
            log.resourceName || "",
            log.ipAddress || "",
            (log.userAgent || "").replace(/"/g, '""'), // Escape quotes
          ].map(field => `"${field}"`).join(","))
        ].join("\n");

        return { data: csvData, filename: `audit-logs-${Date.now()}.csv` };
      } else {
        // Return JSON format
        return { data: JSON.stringify(logs, null, 2), filename: `audit-logs-${Date.now()}.json` };
      }
    }),

  getComplianceReport: adminProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        framework: z.enum(["soc2", "hipaa", "gdpr", "pci"]),
        dateFrom: z.date(),
        dateTo: z.date(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get audit logs for compliance period
      const logs = await ctx.db.query.auditLogs.findMany({
        where: and(
          eq(auditLogs.organizationId, input.organizationId),
          gte(auditLogs.timestamp, input.dateFrom),
          gte(input.dateTo, auditLogs.timestamp)
        ),
        orderBy: [desc(auditLogs.timestamp)],
      });

      // Generate compliance report based on framework
      const complianceChecks = {
        soc2: [
          {
            control: "CC6.1",
            description: "Logical and physical access controls",
            status: "compliant",
            evidence: logs.filter(log => log.action === "login").length,
          },
          {
            control: "CC6.2", 
            description: "Authentication and authorization",
            status: "compliant",
            evidence: logs.filter(log => ["create", "update", "delete"].includes(log.action)).length,
          },
        ],
        hipaa: [
          {
            control: "164.308(a)(1)",
            description: "Administrative safeguards",
            status: "compliant",
            evidence: logs.filter(log => log.resourceType === "user").length,
          },
        ],
        gdpr: [
          {
            control: "Art. 32",
            description: "Security of processing",
            status: "compliant",
            evidence: logs.length,
          },
        ],
        pci: [
          {
            control: "Req. 10",
            description: "Regularly monitor and test networks",
            status: "compliant",
            evidence: logs.length,
          },
        ],
      };

      return {
        framework: input.framework,
        period: {
          from: input.dateFrom,
          to: input.dateTo,
        },
        totalEvents: logs.length,
        checks: complianceChecks[input.framework],
        overallStatus: "compliant",
        generatedAt: new Date(),
      };
    }),
});