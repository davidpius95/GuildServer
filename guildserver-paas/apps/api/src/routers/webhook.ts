import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { webhookDeliveries, applications, members } from "@guildserver/database";
import { eq, desc, and } from "drizzle-orm";

export const webhookRouter = createTRPCRouter({
  // Get webhook URL for an application
  getWebhookUrl: protectedProcedure
    .input(z.object({ applicationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: {
          project: {
            with: {
              organization: {
                with: { members: { where: eq(members.userId, ctx.user.id) } },
              },
            },
          },
        },
      });

      if (!app || app.project.organization.members.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
      }

      const baseUrl = process.env.API_PUBLIC_URL || `http://localhost:4000`;

      return {
        github: `${baseUrl}/webhooks/github`,
        gitlab: `${baseUrl}/webhooks/gitlab`,
        generic: `${baseUrl}/webhooks/git`,
      };
    }),

  // List webhook deliveries for an application
  listDeliveries: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify access
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: {
          project: {
            with: {
              organization: {
                with: { members: { where: eq(members.userId, ctx.user.id) } },
              },
            },
          },
        },
      });

      if (!app || app.project.organization.members.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      const deliveries = await ctx.db.query.webhookDeliveries.findMany({
        where: eq(webhookDeliveries.applicationId, input.applicationId),
        orderBy: [desc(webhookDeliveries.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return deliveries;
    }),

  // Send a test webhook (triggers a deployment)
  sendTestWebhook: protectedProcedure
    .input(z.object({ applicationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: {
          project: {
            with: {
              organization: {
                with: { members: { where: eq(members.userId, ctx.user.id) } },
              },
            },
          },
        },
      });

      if (!app || app.project.organization.members.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
      }

      // Log test delivery
      const [delivery] = await ctx.db
        .insert(webhookDeliveries)
        .values({
          applicationId: input.applicationId,
          provider: "test",
          eventType: "push",
          payload: {
            repository: app.repository,
            branch: app.branch || "main",
            commitSha: "test-webhook",
            commitMessage: "Test webhook delivery",
          },
          statusCode: 200,
          delivered: true,
          processingTimeMs: 0,
        })
        .returning();

      return delivery;
    }),
});
