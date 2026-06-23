import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc";
import { db, baasCustomHostnames } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const CF_API = "https://api.cloudflare.com/client/v4";

async function cfRequest(method: string, path: string, body?: object) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<{ success: boolean; result?: Record<string, unknown>; errors?: unknown[] }>;
}

export const baasDomainRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.select().from(baasCustomHostnames).where(eq(baasCustomHostnames.projectId, input.projectId));
    }),

  add: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), hostname: z.string().min(4) }))
    .mutation(async ({ input }) => {
      const existing = await db.select().from(baasCustomHostnames).where(eq(baasCustomHostnames.hostname, input.hostname));
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Hostname already registered" });

      const cfResp = await cfRequest("POST", `/zones/${process.env.CF_ZONE_ID}/custom_hostnames`, {
        hostname: input.hostname,
        ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.0" } },
      });
      if (!cfResp.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cloudflare API error" });

      const r = cfResp.result!;
      const txtRecord = (r.ownership_verification as Record<string, string> | undefined);

      const [record] = await db.insert(baasCustomHostnames).values({
        projectId:          input.projectId,
        hostname:           input.hostname,
        cfCustomHostnameId: r.id as string,
        cfOwnershipTxtName:  txtRecord?.name,
        cfOwnershipTxtValue: txtRecord?.value,
        cfSslStatus:        (r.ssl as Record<string, string> | undefined)?.status ?? "pending",
        status:             "pending",
      }).returning();

      return record;
    }),

  checkVerification: protectedProcedure
    .input(z.object({ hostnameId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [record] = await db.select().from(baasCustomHostnames).where(eq(baasCustomHostnames.id, input.hostnameId));
      if (!record?.cfCustomHostnameId) throw new TRPCError({ code: "NOT_FOUND" });

      const cfResp = await cfRequest("GET", `/zones/${process.env.CF_ZONE_ID}/custom_hostnames/${record.cfCustomHostnameId}`);
      const r      = cfResp.result;
      const sslStatus = (r?.ssl as Record<string, string> | undefined)?.status ?? record.cfSslStatus;
      const verified  = sslStatus === "active";

      await db.update(baasCustomHostnames)
        .set({ cfSslStatus: sslStatus, verified, status: verified ? "active" : "verifying", updatedAt: new Date() })
        .where(eq(baasCustomHostnames.id, input.hostnameId));

      return { verified, sslStatus };
    }),

  remove: protectedProcedure
    .input(z.object({ hostnameId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [record] = await db.select().from(baasCustomHostnames).where(eq(baasCustomHostnames.id, input.hostnameId));
      if (record?.cfCustomHostnameId) {
        await cfRequest("DELETE", `/zones/${process.env.CF_ZONE_ID}/custom_hostnames/${record.cfCustomHostnameId}`);
      }
      await db.delete(baasCustomHostnames).where(eq(baasCustomHostnames.id, input.hostnameId));
    }),
});
