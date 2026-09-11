/**
 * Organization notification channels: where events are sent (email, webhook,
 * Discord, Slack, Telegram) and which events each one receives.
 *
 * Credentials are write-only. Members can see that a channel exists and, in
 * outline, where it points; only owners and admins can change channels or
 * make the server send to them. Another organization's channel is
 * indistinguishable from a missing one.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { members, notificationChannels, notificationDeliveries } from "@guildserver/database";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { encryptSecret } from "../utils/crypto";
import { NOTIFICATION_EVENTS } from "../services/notifications/events";
import {
  DeliveryError,
  validateChannelTarget,
  type ChannelConfig,
  type ChannelSecret,
  type ChannelType,
} from "../services/notifications/providers";
import { channelSecret, sendTestMessage } from "../services/notifications/dispatch";
import { mailerFromEnv } from "../services/notifications/mailer";

type ChannelRow = typeof notificationChannels.$inferSelect;

const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("slack"), url: z.string().max(2048) }),
  z.object({ type: z.literal("discord"), url: z.string().max(2048) }),
  z.object({ type: z.literal("webhook"), url: z.string().max(2048), signingSecret: z.string().min(16).max(256).optional() }),
  z.object({ type: z.literal("telegram"), botToken: z.string().max(128), chatId: z.string().max(64) }),
  z.object({ type: z.literal("email"), recipients: z.array(z.string().trim().max(254)).min(1).max(20) }),
]);
type Target = z.infer<typeof targetSchema>;

const eventsSchema = z
  .array(z.enum(NOTIFICATION_EVENTS))
  .min(1)
  .max(NOTIFICATION_EVENTS.length * 2)
  .transform((events) => Array.from(new Set(events)));

async function roleIn(ctx: any, organizationId: string) {
  const member = await ctx.db.query.members.findFirst({
    where: and(eq(members.organizationId, organizationId), eq(members.userId, ctx.user.id)),
  });
  return member?.role as "owner" | "admin" | "member" | undefined;
}

async function requireManager(ctx: any, organizationId: string) {
  const role = await roleIn(ctx, organizationId);
  if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found or access denied" });
  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an organization owner or admin can manage notification channels" });
  }
}

async function loadChannel(ctx: any, id: string, manage: boolean): Promise<ChannelRow> {
  const [channel] = await ctx.db.select().from(notificationChannels).where(eq(notificationChannels.id, id)).limit(1);
  if (!channel || !(await roleIn(ctx, channel.organizationId))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Notification channel not found" });
  }
  if (manage) await requireManager(ctx, channel.organizationId);
  return channel;
}

function splitTarget(target: Target): { config: ChannelConfig; secret: ChannelSecret } {
  switch (target.type) {
    case "slack":
    case "discord":
      return { config: {}, secret: { url: target.url } };
    case "webhook":
      return { config: {}, secret: { url: target.url, signingSecret: target.signingSecret } };
    case "telegram":
      return { config: { chatId: target.chatId }, secret: { botToken: target.botToken } };
    case "email":
      return { config: { recipients: target.recipients }, secret: {} };
  }
}

async function checkTarget(type: ChannelType, config: ChannelConfig, secret: ChannelSecret): Promise<void> {
  try {
    await validateChannelTarget(type, config, secret, { env: process.env, mailer: type === "email" ? mailerFromEnv() : null });
  } catch (error) {
    if (error instanceof DeliveryError) {
      const unconfigured = type === "email" && /not configured/.test(error.message);
      throw new TRPCError({ code: unconfigured ? "PRECONDITION_FAILED" : "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

function storedSecret(secret: ChannelSecret): string | null {
  const present = Object.fromEntries(Object.entries(secret).filter(([, value]) => value !== undefined && value !== ""));
  return Object.keys(present).length > 0 ? encryptSecret(JSON.stringify(present)) : null;
}

/** Where a channel points, in words that reveal no credential. */
function describeTarget(row: ChannelRow): string {
  const config = (row.config ?? {}) as ChannelConfig;
  switch (row.type) {
    case "slack":
      return "hooks.slack.com";
    case "discord":
      return "discord.com";
    case "telegram":
      return `Telegram chat ${config.chatId ?? ""}`.trim();
    case "email":
      return (config.recipients ?? []).join(", ");
    case "webhook":
      try {
        const url = channelSecret(row).url;
        return url ? new URL(url).host : "webhook";
      } catch {
        return "webhook";
      }
    default:
      return row.type;
  }
}

function publicChannel(row: ChannelRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    type: row.type,
    events: row.events,
    enabled: row.enabled,
    target: describeTarget(row),
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryOk: row.lastDeliveryOk,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const notificationChannelRouter = createTRPCRouter({
  events: protectedProcedure.query(() => NOTIFICATION_EVENTS),

  list: protectedProcedure.input(z.object({ organizationId: z.string().uuid() })).query(async ({ ctx, input }) => {
    if (!(await roleIn(ctx, input.organizationId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found or access denied" });
    }
    const rows: ChannelRow[] = await ctx.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.organizationId, input.organizationId))
      .orderBy(asc(notificationChannels.createdAt));
    return rows.map(publicChannel);
  }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        events: eventsSchema,
        enabled: z.boolean().default(true),
        target: targetSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireManager(ctx, input.organizationId);
      const { config, secret } = splitTarget(input.target);
      await checkTarget(input.target.type, config, secret);
      const [row] = await ctx.db
        .insert(notificationChannels)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          type: input.target.type,
          config: config as Record<string, unknown>,
          secret: storedSecret(secret),
          events: input.events,
          enabled: input.enabled,
          createdBy: ctx.user.id,
        })
        .returning();
      return publicChannel(row);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        events: eventsSchema.optional(),
        enabled: z.boolean().optional(),
        target: targetSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const channel = await loadChannel(ctx, input.id, true);
      const changes: Partial<typeof notificationChannels.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) changes.name = input.name;
      if (input.events !== undefined) changes.events = input.events;
      if (input.enabled !== undefined) changes.enabled = input.enabled;
      if (input.target) {
        if (input.target.type !== channel.type) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A channel's type cannot be changed; create a new channel instead" });
        }
        const { config, secret } = splitTarget(input.target);
        await checkTarget(input.target.type, config, secret);
        changes.config = config as Record<string, unknown>;
        changes.secret = storedSecret(secret);
      }
      const [row] = await ctx.db.update(notificationChannels).set(changes).where(eq(notificationChannels.id, channel.id)).returning();
      return publicChannel(row);
    }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const channel = await loadChannel(ctx, input.id, true);
    await ctx.db.delete(notificationChannels).where(eq(notificationChannels.id, channel.id));
    return { success: true };
  }),

  test: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const channel = await loadChannel(ctx, input.id, true);
    const result = await sendTestMessage(channel);
    await ctx.db
      .update(notificationChannels)
      .set({ lastDeliveryAt: new Date(), lastDeliveryOk: result.ok, lastError: result.ok ? null : result.error })
      .where(eq(notificationChannels.id, channel.id));
    return result;
  }),

  deliveries: protectedProcedure
    .input(z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const channel = await loadChannel(ctx, input.id, false);
      return ctx.db
        .select({
          id: notificationDeliveries.id,
          event: notificationDeliveries.event,
          status: notificationDeliveries.status,
          attempts: notificationDeliveries.attempts,
          error: notificationDeliveries.error,
          createdAt: notificationDeliveries.createdAt,
          deliveredAt: notificationDeliveries.deliveredAt,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.channelId, channel.id))
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(input.limit);
    }),
});
