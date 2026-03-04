import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc/trpc";
import { computeProviders } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { ProxmoxClient } from "../services/proxmox-client";
import type { ProxmoxConfig } from "../providers/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a Proxmox-type provider from the DB, validate it, and return both
 * the DB record and a ready-to-use ProxmoxClient.
 *
 * @throws TRPCError NOT_FOUND if the provider doesn't exist.
 * @throws TRPCError BAD_REQUEST if the provider isn't a Proxmox type.
 */
async function resolveProxmoxProvider(
  db: any,
  providerId: string,
): Promise<{ provider: typeof computeProviders.$inferSelect; client: ProxmoxClient; config: ProxmoxConfig }> {
  const provider = await db.query.computeProviders.findFirst({
    where: eq(computeProviders.id, providerId),
  });

  if (!provider) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
  }

  if (provider.type !== "proxmox") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Provider "${provider.name}" is type "${provider.type}", not "proxmox". Infrastructure operations are only available for Proxmox providers.`,
    });
  }

  const config = provider.config as ProxmoxConfig;

  const client = new ProxmoxClient({
    host: config.host,
    port: config.port || 8006,
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret,
    allowInsecure: true, // Proxmox often uses self-signed certs
  });

  return { provider, client, config };
}

/**
 * Format bytes into a human-readable string (e.g. "4.00 GB").
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const infrastructureRouter = createTRPCRouter({
  /**
   * Get live resource usage (CPU, memory, disk) for a Proxmox node.
   *
   * Queries the Proxmox VE API in real-time. Returns both raw numbers
   * and human-readable formatted values for frontend display.
   */
  getNodeResources: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { client, config, provider } = await resolveProxmoxProvider(ctx.db, input.id);

      try {
        const status = await client.getNodeStatus(config.node);

        return {
          providerId: input.id,
          providerName: provider.name,
          node: config.node,
          cpu: {
            usage: status.cpu, // 0.0 – 1.0 fraction
            usagePercent: Math.round(status.cpu * 100),
            cores: status.maxcpu,
          },
          memory: {
            used: status.mem,
            total: status.maxmem,
            usagePercent: Math.round((status.mem / status.maxmem) * 100),
            usedFormatted: formatBytes(status.mem),
            totalFormatted: formatBytes(status.maxmem),
          },
          disk: {
            used: status.disk,
            total: status.maxdisk,
            usagePercent: Math.round((status.disk / status.maxdisk) * 100),
            usedFormatted: formatBytes(status.disk),
            totalFormatted: formatBytes(status.maxdisk),
          },
          uptime: status.uptime, // seconds
          status: status.status,
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch node resources: ${err.message}`,
        });
      }
    }),

  /**
   * List all LXC containers on a Proxmox node.
   *
   * Returns container ID, name, status, and resource usage for each LXC.
   * Useful for the admin UI to see what's running on a node.
   */
  listLxcContainers: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { client, config, provider } = await resolveProxmoxProvider(ctx.db, input.id);

      try {
        const containers = await client.listLXCs(config.node);

        return {
          providerId: input.id,
          providerName: provider.name,
          node: config.node,
          containers: containers.map((c) => ({
            vmid: c.vmid,
            name: c.name,
            status: c.status,
            cpu: c.cpu,
            maxcpu: c.maxcpu,
            memory: {
              used: c.mem,
              total: c.maxmem,
              usagePercent: c.maxmem > 0 ? Math.round((c.mem / c.maxmem) * 100) : 0,
              usedFormatted: formatBytes(c.mem),
              totalFormatted: formatBytes(c.maxmem),
            },
            disk: {
              used: c.disk,
              total: c.maxdisk,
              usagePercent: c.maxdisk > 0 ? Math.round((c.disk / c.maxdisk) * 100) : 0,
              usedFormatted: formatBytes(c.disk),
              totalFormatted: formatBytes(c.maxdisk),
            },
            isGuildServer: c.name?.startsWith("gs-") ?? false,
          })),
          total: containers.length,
          guildServerManaged: containers.filter((c) => c.name?.startsWith("gs-")).length,
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list LXC containers: ${err.message}`,
        });
      }
    }),

  /**
   * List storage pools available on a Proxmox node.
   *
   * Used by the setup wizard to let admins choose which storage pool
   * to use for LXC rootfs.
   */
  listStorages: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { client, config, provider } = await resolveProxmoxProvider(ctx.db, input.id);

      try {
        const storages = await client.listStorage(config.node);

        return {
          providerId: input.id,
          providerName: provider.name,
          node: config.node,
          storages: storages.map((s) => ({
            storage: s.storage,
            type: s.type,
            content: s.content,
            total: s.total,
            used: s.used,
            available: s.avail,
            usagePercent: s.total > 0 ? Math.round((s.used / s.total) * 100) : 0,
            totalFormatted: formatBytes(s.total),
            usedFormatted: formatBytes(s.used),
            availableFormatted: formatBytes(s.avail),
            active: !!s.active,
            // Flag storages that support rootfs (for LXC creation)
            supportsRootfs: s.content.includes("rootdir") || s.content.includes("images"),
          })),
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list storage pools: ${err.message}`,
        });
      }
    }),

  /**
   * List available container templates on a Proxmox node.
   *
   * Searches the provider's configured default storage (or a specified
   * storage) for CT templates (vztmpl). Used by the setup wizard.
   */
  listTemplates: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        storage: z.string().optional(), // override the default storage
      }),
    )
    .query(async ({ ctx, input }) => {
      const { client, config, provider } = await resolveProxmoxProvider(ctx.db, input.id);

      const storage = input.storage || config.storage;

      try {
        const templates = await client.listTemplates(config.node, storage);

        return {
          providerId: input.id,
          providerName: provider.name,
          node: config.node,
          storage,
          templates: templates.map((t) => ({
            volid: t.volid,
            format: t.format,
            size: t.size,
            sizeFormatted: formatBytes(t.size),
            // Extract a friendly name from the volid
            // e.g. "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
            // → "ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
            name: t.volid.includes("/") ? t.volid.split("/").pop()! : t.volid,
          })),
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list templates: ${err.message}`,
        });
      }
    }),

  /**
   * Toggle maintenance mode on a provider.
   *
   * When a provider is in maintenance mode (status = "disabled"), no new
   * deployments will be routed to it. Existing deployments continue to
   * run unaffected.
   *
   * This toggles between "disabled" and "connected" status.
   */
  setMaintenance: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        maintenance: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const provider = await ctx.db.query.computeProviders.findFirst({
        where: eq(computeProviders.id, input.id),
      });

      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      }

      const newStatus = input.maintenance ? "disabled" : "connected";

      // If coming out of maintenance, verify the connection is still healthy
      let healthMessage = provider.healthMessage;
      if (!input.maintenance && provider.type === "proxmox") {
        try {
          const config = provider.config as ProxmoxConfig;
          const client = new ProxmoxClient({
            host: config.host,
            port: config.port || 8006,
            tokenId: config.tokenId,
            tokenSecret: config.tokenSecret,
            allowInsecure: true,
          });
          const result = await client.testConnection();
          if (!result.connected) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Cannot take provider out of maintenance — connection check failed: ${result.message}`,
            });
          }
          healthMessage = result.message;
        } catch (err: any) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot take provider out of maintenance — connection check failed: ${err.message}`,
          });
        }
      }

      const [updated] = await ctx.db
        .update(computeProviders)
        .set({
          status: newStatus,
          healthMessage,
          lastHealthCheck: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(computeProviders.id, input.id))
        .returning();

      return {
        ...updated,
        config: {}, // never expose credentials
      };
    }),

  /**
   * Download a container template to a Proxmox node's storage.
   *
   * Templates are required for creating LXC containers. This endpoint
   * triggers the download of an official template from the Proxmox
   * appliance repository. The download happens on the Proxmox node
   * itself (server-side), not on the GuildServer API server.
   *
   * For GuildServer deployments, you need an Ubuntu template with Docker
   * pre-installed, or a standard Ubuntu template (Docker will need to be
   * set up manually in the LXC).
   */
  downloadTemplate: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        storage: z.string().optional(),
        template: z.string(), // e.g. "ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { client, config, provider } = await resolveProxmoxProvider(ctx.db, input.id);
      const storage = input.storage || config.storage;

      try {
        const upid = await client.downloadTemplate(
          config.node,
          storage,
          input.template,
        );

        return {
          providerId: input.id,
          providerName: provider.name,
          node: config.node,
          storage,
          template: input.template,
          taskUpid: upid,
          message: `Template download started on ${config.node}. This may take a few minutes.`,
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to download template: ${err.message}`,
        });
      }
    }),

  /**
   * Get a summary overview of all Proxmox providers with their live status.
   *
   * Unlike `provider.list`, this returns enriched data by querying each
   * Proxmox node's API for current resource usage. Useful for the
   * infrastructure dashboard.
   */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const providers = await ctx.db.query.computeProviders.findMany({
      orderBy: (cp, { desc }) => [desc(cp.createdAt)],
    });

    // Filter to only Proxmox providers (this router is Proxmox-specific)
    const proxmoxProviders = providers.filter((p) => p.type === "proxmox");

    const results = await Promise.allSettled(
      proxmoxProviders.map(async (provider) => {
        const config = provider.config as ProxmoxConfig;
        const client = new ProxmoxClient({
          host: config.host,
          port: config.port || 8006,
          tokenId: config.tokenId,
          tokenSecret: config.tokenSecret,
          allowInsecure: true,
        });

        try {
          const status = await client.getNodeStatus(config.node);
          return {
            id: provider.id,
            name: provider.name,
            node: config.node,
            host: config.host,
            status: provider.status,
            region: provider.region,
            isDefault: provider.isDefault,
            lastHealthCheck: provider.lastHealthCheck,
            healthMessage: provider.healthMessage,
            live: {
              reachable: true,
              cpu: {
                usagePercent: Math.round(status.cpu * 100),
                cores: status.maxcpu,
              },
              memory: {
                usagePercent: Math.round((status.mem / status.maxmem) * 100),
                usedFormatted: formatBytes(status.mem),
                totalFormatted: formatBytes(status.maxmem),
              },
              disk: {
                usagePercent: Math.round((status.disk / status.maxdisk) * 100),
                usedFormatted: formatBytes(status.disk),
                totalFormatted: formatBytes(status.maxdisk),
              },
              uptime: status.uptime,
            },
          };
        } catch {
          return {
            id: provider.id,
            name: provider.name,
            node: config.node,
            host: config.host,
            status: provider.status,
            region: provider.region,
            isDefault: provider.isDefault,
            lastHealthCheck: provider.lastHealthCheck,
            healthMessage: provider.healthMessage,
            live: {
              reachable: false,
            },
          };
        }
      }),
    );

    return results.map((r) => (r.status === "fulfilled" ? r.value : null)).filter(Boolean);
  }),
});
