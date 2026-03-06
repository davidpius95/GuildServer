import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc/trpc";
import { computeProviders, applications } from "@guildserver/database";
import { eq, and, count } from "drizzle-orm";
import { createProviderFromConfig } from "../providers/factory";
import { listAvailableProviders, isProviderImplemented } from "../providers/registry";
import { removeClientByHost } from "../services/node-docker";
import type { ProviderType, ProviderConfig } from "../providers/types";

const providerTypeValues = [
  "docker-local",
  "docker-remote",
  "proxmox",
  "kubernetes",
  "aws-ecs",
  "gcp-cloudrun",
  "azure-aci",
  "hetzner",
  "digitalocean",
] as const;

const createProviderSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(providerTypeValues),
  config: z.record(z.unknown()).default({}),
  region: z.string().max(100).optional(),
  isDefault: z.boolean().default(false),
  organizationId: z.string().uuid().optional(),
});

const updateProviderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  config: z.record(z.unknown()).optional(),
  region: z.string().max(100).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export const providerRouter = createTRPCRouter({
  // List all providers (optionally filtered by org)
  list: adminProcedure
    .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const providers = await ctx.db.query.computeProviders.findMany({
        orderBy: (cp, { desc }) => [desc(cp.createdAt)],
      });

      // Strip sensitive config fields from response — never expose credentials
      return providers.map((p) => ({
        ...p,
        config: {}, // never send config to frontend
      }));
    }),

  // Get provider by ID
  getById: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const provider = await ctx.db.query.computeProviders.findFirst({
        where: eq(computeProviders.id, input.id),
      });

      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      }

      return {
        ...provider,
        config: {}, // never expose credentials
      };
    }),

  // Create a new provider (admin only)
  create: adminProcedure
    .input(createProviderSchema)
    .mutation(async ({ ctx, input }) => {
      // If setting as default, unset any existing default for this org
      if (input.isDefault && input.organizationId) {
        await ctx.db
          .update(computeProviders)
          .set({ isDefault: false })
          .where(
            and(
              eq(computeProviders.organizationId, input.organizationId),
              eq(computeProviders.isDefault, true)
            )
          );
      }

      // Test connection before saving
      let connectionStatus: "connected" | "error" = "pending" as any;
      let healthMessage = "";

      try {
        const provider = createProviderFromConfig(
          input.type as ProviderType,
          input.config as ProviderConfig
        );
        const result = await provider.testConnection();
        connectionStatus = result.connected ? "connected" : "error";
        healthMessage = result.message;
      } catch (err: any) {
        connectionStatus = "error";
        healthMessage = err.message || "Connection test failed";
      }

      const [newProvider] = await ctx.db
        .insert(computeProviders)
        .values({
          name: input.name,
          type: input.type,
          config: input.config,
          region: input.region,
          isDefault: input.isDefault,
          organizationId: input.organizationId,
          status: connectionStatus,
          lastHealthCheck: new Date(),
          healthMessage,
        })
        .returning();

      return {
        ...newProvider,
        config: {}, // never expose credentials in response
      };
    }),

  // Update an existing provider (admin only)
  update: adminProcedure
    .input(updateProviderSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.computeProviders.findFirst({
        where: eq(computeProviders.id, input.id),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      }

      // If setting as default, unset any existing default for this org
      if (input.isDefault && existing.organizationId) {
        await ctx.db
          .update(computeProviders)
          .set({ isDefault: false })
          .where(
            and(
              eq(computeProviders.organizationId, existing.organizationId),
              eq(computeProviders.isDefault, true)
            )
          );
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.config !== undefined) updateData.config = input.config;
      if (input.region !== undefined) updateData.region = input.region;
      if (input.isDefault !== undefined) updateData.isDefault = input.isDefault;

      const [updated] = await ctx.db
        .update(computeProviders)
        .set(updateData)
        .where(eq(computeProviders.id, input.id))
        .returning();

      return {
        ...updated,
        config: {},
      };
    }),

  // Delete a provider (admin only)
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if any apps are using this provider
      const appsUsingProvider = await ctx.db
        .select({ count: count() })
        .from(applications)
        .where(eq(applications.providerId, input.id));

      const appCount = appsUsingProvider[0]?.count ?? 0;
      if (appCount > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete this provider — ${appCount} application(s) are using it. Reassign them first.`,
        });
      }

      // Look up the provider config BEFORE deleting so we can clean up
      // cached Docker clients keyed by host:port (not by UUID).
      const provider = await ctx.db.query.computeProviders.findFirst({
        where: eq(computeProviders.id, input.id),
      });

      await ctx.db
        .delete(computeProviders)
        .where(eq(computeProviders.id, input.id));

      // Clean up any cached Docker client associated with this provider.
      // The client pool keys by `host:port`, so we extract the host from
      // the provider config rather than using the UUID.
      if (provider?.type === "proxmox" && provider.config) {
        const config = provider.config as { host?: string };
        if (config.host) {
          removeClientByHost(config.host);
        }
      }

      return { success: true };
    }),

  // Test connection to a provider (admin only)
  testConnection: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const provider = await ctx.db.query.computeProviders.findFirst({
        where: eq(computeProviders.id, input.id),
      });

      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      }

      try {
        const instance = createProviderFromConfig(
          provider.type as ProviderType,
          provider.config as ProviderConfig
        );
        const result = await instance.testConnection();

        // Update status in DB
        await ctx.db
          .update(computeProviders)
          .set({
            status: result.connected ? "connected" : "error",
            lastHealthCheck: new Date(),
            healthMessage: result.message,
            metadata: result.details ? { ...((provider.metadata as object) || {}), ...result.details } : provider.metadata,
            updatedAt: new Date(),
          })
          .where(eq(computeProviders.id, input.id));

        return result;
      } catch (err: any) {
        // Update status to error
        await ctx.db
          .update(computeProviders)
          .set({
            status: "error",
            lastHealthCheck: new Date(),
            healthMessage: err.message,
            updatedAt: new Date(),
          })
          .where(eq(computeProviders.id, input.id));

        return {
          connected: false,
          message: err.message || "Connection test failed",
        };
      }
    }),

  // List all available provider types (for the UI wizard)
  listAvailable: adminProcedure.query(async () => {
    const allProviders = listAvailableProviders();

    return allProviders.map((p) => ({
      ...p,
      implemented: isProviderImplemented(p.type),
    }));
  }),
});
