import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import {
  notifications,
  notificationPreferences,
  slackConfigs,
  members,
} from "@guildserver/database";
import { eq, and, desc, sql } from "drizzle-orm";
import { NOTIFICATION_EVENTS } from "../services/notifications/events";
import { DeliveryError, sendToChannel, validateChannelTarget } from "../services/notifications/providers";
import { defaultProviderDeps } from "../services/notifications/dispatch";

export const notificationRouter = createTRPCRouter({
  // List notifications for the current user
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(20),
        offset: z.number().default(0),
        unreadOnly: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(notifications.userId, ctx.user.id)];
      if (input.unreadOnly) {
        conditions.push(eq(notifications.read, false));
      }

      const items = await ctx.db.query.notifications.findMany({
        where: and(...conditions),
        orderBy: [desc(notifications.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return items;
    }),

  // Get unread notification count
  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.read, false)
        )
      );

    return { count: result[0]?.count ?? 0 };
  }),

  // Mark a single notification as read
  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.id, input.id),
            eq(notifications.userId, ctx.user.id)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification not found",
        });
      }

      return updated;
    }),

  // Mark all notifications as read
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.read, false)
        )
      );

    return { success: true };
  }),

  // Get notification preferences for the current user
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await ctx.db.query.notificationPreferences.findMany({
      where: eq(notificationPreferences.userId, ctx.user.id),
    });

    // Build a complete map with defaults for any missing events
    const prefsMap: Record<
      string,
      { emailEnabled: boolean; slackEnabled: boolean; inAppEnabled: boolean }
    > = {};

    for (const event of NOTIFICATION_EVENTS) {
      const existing = prefs.find((p) => p.event === event);
      prefsMap[event] = {
        emailEnabled: existing?.emailEnabled ?? true,
        slackEnabled: existing?.slackEnabled ?? false,
        inAppEnabled: existing?.inAppEnabled ?? true,
      };
    }

    return prefsMap;
  }),

  // Update notification preferences for a specific event
  updatePreferences: protectedProcedure
    .input(
      z.object({
        event: z.enum(NOTIFICATION_EVENTS),
        emailEnabled: z.boolean().optional(),
        slackEnabled: z.boolean().optional(),
        inAppEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Try to update existing preference
      const existing = await ctx.db.query.notificationPreferences.findFirst({
        where: and(
          eq(notificationPreferences.userId, ctx.user.id),
          eq(notificationPreferences.event, input.event)
        ),
      });

      if (existing) {
        const updateData: Record<string, any> = { updatedAt: new Date() };
        if (input.emailEnabled !== undefined)
          updateData.emailEnabled = input.emailEnabled;
        if (input.slackEnabled !== undefined)
          updateData.slackEnabled = input.slackEnabled;
        if (input.inAppEnabled !== undefined)
          updateData.inAppEnabled = input.inAppEnabled;

        const [updated] = await ctx.db
          .update(notificationPreferences)
          .set(updateData)
          .where(eq(notificationPreferences.id, existing.id))
          .returning();

        return updated;
      }

      // Create new preference
      const [created] = await ctx.db
        .insert(notificationPreferences)
        .values({
          userId: ctx.user.id,
          event: input.event,
          emailEnabled: input.emailEnabled ?? true,
          slackEnabled: input.slackEnabled ?? false,
          inAppEnabled: input.inAppEnabled ?? true,
        })
        .returning();

      return created;
    }),

  // Get Slack config for an organization
  getSlackConfig: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify user is member of the org
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this organization",
        });
      }

      const config = await ctx.db.query.slackConfigs.findFirst({
        where: eq(slackConfigs.organizationId, input.organizationId),
      });

      // The webhook URL is a credential: anyone holding it can post to the
      // channel. Say whether one is set, never what it is.
      if (!config) return null;
      return {
        id: config.id,
        organizationId: config.organizationId,
        channelName: config.channelName,
        enabled: config.enabled,
        createdAt: config.createdAt,
        hasWebhook: Boolean(config.webhookUrl),
      };
    }),

  // Set Slack webhook config for an organization
  setSlackConfig: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        webhookUrl: z.string().url(),
        channelName: z.string().optional(),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify user has admin+ role in the org
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || member.role === "member") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      try {
        await validateChannelTarget("slack", {}, { url: input.webhookUrl }, { env: process.env, mailer: null });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof DeliveryError ? error.message : "Invalid Slack webhook URL",
        });
      }

      // Upsert: check if config exists
      const existing = await ctx.db.query.slackConfigs.findFirst({
        where: eq(slackConfigs.organizationId, input.organizationId),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(slackConfigs)
          .set({
            webhookUrl: input.webhookUrl,
            channelName: input.channelName || null,
            enabled: input.enabled,
          })
          .where(eq(slackConfigs.id, existing.id))
          .returning();

        return updated;
      }

      const [created] = await ctx.db
        .insert(slackConfigs)
        .values({
          organizationId: input.organizationId,
          webhookUrl: input.webhookUrl,
          channelName: input.channelName || null,
          enabled: input.enabled,
        })
        .returning();

      return created;
    }),

  // Test Slack notification
  testSlackNotification: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Making the server post to an organization's channel is an admin
      // action, like configuring it.
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || member.role === "member") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      const config = await ctx.db.query.slackConfigs.findFirst({
        where: and(
          eq(slackConfigs.organizationId, input.organizationId),
          eq(slackConfigs.enabled, true)
        ),
      });

      if (!config?.webhookUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No Slack webhook configured or it is disabled",
        });
      }

      try {
        await sendToChannel(
          "slack",
          {},
          { url: config.webhookUrl },
          {
            event: "test",
            title: "GuildServer test notification",
            message: "Your Slack integration is working.",
            severity: "info",
            occurredAt: new Date().toISOString(),
          },
          defaultProviderDeps()
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof DeliveryError ? error.message : "Slack test notification failed",
        });
      }

      return { success: true };
    }),
});
