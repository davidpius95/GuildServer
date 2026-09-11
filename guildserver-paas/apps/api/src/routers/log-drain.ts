/**
 * Log drains: forward an application's or Compose stack's container logs to
 * an HTTP endpoint (Fluent Bit's http input, Vector, Axiom, Better Stack, or
 * anything accepting JSON).
 *
 * The endpoint URL and header values are write-only. Members see which
 * resources are drained and to which host; owners and admins manage drains.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq } from "drizzle-orm";
import { applications, logDrains, projects, services } from "@guildserver/database";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { organizationRole, requireOrganizationManager, requireOrganizationMember } from "../trpc/org-access";
import { encryptSecret } from "../utils/crypto";
import { UnsafeUrlError, assertSafeOutboundUrl } from "../utils/outbound-url";
import { DrainConfigError, validateDrainHeaders } from "../services/log-drain/records";
import { DRAIN_FORMATS, DrainDeliveryError, LOG_DRAIN_OUTBOUND_POLICY, postBatch, type DrainTarget } from "../services/log-drain/shipper";
import { readDrainTarget } from "../services/log-drain/store";

type DrainRow = typeof logDrains.$inferSelect;

export const MAX_DRAINS_PER_ORGANIZATION = 50;
const WHAT = "log drains";

const targetSchema = z.object({
  url: z.string().max(2048),
  headers: z.record(z.string().max(64), z.string().max(1024)).default({}),
  format: z.enum(DRAIN_FORMATS).default("json"),
});

const resourceSchema = z.object({
  type: z.enum(["application", "service"]),
  id: z.string().uuid(),
});

async function checkTarget(target: DrainTarget): Promise<void> {
  try {
    await assertSafeOutboundUrl(target.url, LOG_DRAIN_OUTBOUND_POLICY);
    validateDrainHeaders(target.headers);
  } catch (error) {
    if (error instanceof UnsafeUrlError || error instanceof DrainConfigError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

function sealTarget(target: DrainTarget): string {
  return encryptSecret(JSON.stringify({ url: target.url, headers: target.headers }))!;
}

/** The resource, only if it belongs to the organization. */
async function resourceIn(ctx: any, organizationId: string, resource: z.infer<typeof resourceSchema>): Promise<{ name: string }> {
  const table = resource.type === "application" ? applications : services;
  const nameColumn = resource.type === "application" ? applications.appName : services.name;
  const [row] = await ctx.db
    .select({ name: nameColumn, organizationId: projects.organizationId })
    .from(table)
    .innerJoin(projects, eq(table.projectId, projects.id))
    .where(eq(table.id, resource.id))
    .limit(1);
  if (!row || row.organizationId !== organizationId) {
    throw new TRPCError({ code: "NOT_FOUND", message: resource.type === "application" ? "Application not found" : "Service not found" });
  }
  return { name: row.name };
}

async function loadDrain(ctx: any, id: string, manage: boolean): Promise<DrainRow> {
  const [drain] = await ctx.db.select().from(logDrains).where(eq(logDrains.id, id)).limit(1);
  if (!drain || !(await organizationRole(ctx, drain.organizationId))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Log drain not found" });
  }
  if (manage) await requireOrganizationManager(ctx, drain.organizationId, WHAT);
  return drain;
}

function publicDrain(row: DrainRow) {
  let host = "";
  let headerNames: string[] = [];
  try {
    const target = readDrainTarget(row);
    host = new URL(target.url).host;
    headerNames = Object.keys(target.headers);
  } catch {
    host = "unreadable";
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    resource: row.applicationId
      ? { type: "application" as const, id: row.applicationId }
      : { type: "service" as const, id: row.serviceId! },
    host,
    headerNames,
    format: row.format,
    enabled: row.enabled,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryOk: row.lastDeliveryOk,
    lastError: row.lastError,
    recordsSent: row.recordsSent,
    recordsDropped: row.recordsDropped,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const logDrainRouter = createTRPCRouter({
  list: protectedProcedure.input(z.object({ organizationId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await requireOrganizationMember(ctx, input.organizationId);
    const rows: DrainRow[] = await ctx.db
      .select()
      .from(logDrains)
      .where(eq(logDrains.organizationId, input.organizationId))
      .orderBy(asc(logDrains.createdAt));
    return rows.map(publicDrain);
  }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        resource: resourceSchema,
        target: targetSchema,
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationManager(ctx, input.organizationId, WHAT);
      await resourceIn(ctx, input.organizationId, input.resource);
      await checkTarget(input.target);
      const [{ value: existing }] = await ctx.db
        .select({ value: count() })
        .from(logDrains)
        .where(eq(logDrains.organizationId, input.organizationId));
      if (Number(existing) >= MAX_DRAINS_PER_ORGANIZATION) {
        throw new TRPCError({ code: "CONFLICT", message: `An organization can have at most ${MAX_DRAINS_PER_ORGANIZATION} log drains` });
      }
      const [row] = await ctx.db
        .insert(logDrains)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          applicationId: input.resource.type === "application" ? input.resource.id : null,
          serviceId: input.resource.type === "service" ? input.resource.id : null,
          secret: sealTarget(input.target),
          format: input.target.format,
          enabled: input.enabled,
          createdBy: ctx.user.id,
        })
        .returning();
      return publicDrain(row);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        enabled: z.boolean().optional(),
        target: targetSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const drain = await loadDrain(ctx, input.id, true);
      const changes: Partial<typeof logDrains.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) changes.name = input.name;
      if (input.enabled !== undefined) changes.enabled = input.enabled;
      if (input.target) {
        await checkTarget(input.target);
        changes.secret = sealTarget(input.target);
        changes.format = input.target.format;
      }
      const [row] = await ctx.db.update(logDrains).set(changes).where(eq(logDrains.id, drain.id)).returning();
      return publicDrain(row);
    }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const drain = await loadDrain(ctx, input.id, true);
    await ctx.db.delete(logDrains).where(and(eq(logDrains.id, drain.id), eq(logDrains.organizationId, drain.organizationId)));
    return { success: true };
  }),

  /** Send one test record now, instead of waiting for the next log line. */
  test: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const drain = await loadDrain(ctx, input.id, true);
    let result: { ok: true } | { ok: false; error: string };
    try {
      const target = readDrainTarget(drain);
      await assertSafeOutboundUrl(target.url, LOG_DRAIN_OUTBOUND_POLICY);
      await postBatch(
        target,
        [
          {
            timestamp: new Date().toISOString(),
            message: `GuildServer log drain test for "${drain.name}"`,
            stream: "stdout",
            resource: drain.applicationId
              ? { type: "application", id: drain.applicationId, name: "" }
              : { type: "service", id: drain.serviceId!, name: "" },
            container: { id: "", name: "" },
            source: "guildserver",
          },
        ],
        { fetch: globalThis.fetch.bind(globalThis), env: process.env },
      );
      result = { ok: true };
    } catch (error) {
      const message =
        error instanceof DrainDeliveryError || error instanceof UnsafeUrlError ? error.message : "Unexpected error while sending the test record";
      result = { ok: false, error: message };
    }
    await ctx.db
      .update(logDrains)
      .set({ lastDeliveryAt: new Date(), lastDeliveryOk: result.ok, lastError: result.ok ? null : result.error })
      .where(eq(logDrains.id, drain.id));
    return result;
  }),
});
