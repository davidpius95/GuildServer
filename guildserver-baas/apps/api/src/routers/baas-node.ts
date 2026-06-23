import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc/trpc";
import { db, baasNodes, baasProjects } from "@guildserver/baas-db";
import { eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const baasNodeRouter = router({
  list: protectedProcedure.query(async () => {
    return db.select().from(baasNodes);
  }),

  get: protectedProcedure
    .input(z.object({ nodeId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, input.nodeId));
      if (!node) throw new TRPCError({ code: "NOT_FOUND" });
      return node;
    }),

  register: adminProcedure
    .input(z.object({
      name:           z.string().min(1),
      hostname:       z.string().min(1),
      internalIp:     z.string().ip(),
      externalIp:     z.string().ip().optional(),
      role:           z.enum(["edge", "compute", "storage"]).default("compute"),
      vcpuTotal:      z.number().int().min(1),
      ramMbTotal:     z.number().int().min(512),
      storageGbTotal: z.number().int().min(10),
      sshUser:        z.string().default("root"),
      sshPort:        z.number().int().default(22),
      sshPrivateKey:  z.string().optional(),
      providerId:     z.string().uuid().optional(),
      location:       z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [node] = await db.insert(baasNodes).values(input).returning();
      return node;
    }),

  update: adminProcedure
    .input(z.object({
      nodeId: z.string().uuid(),
      status: z.enum(["online", "offline", "maintenance", "error"]).optional(),
      role:   z.enum(["edge", "compute", "storage"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { nodeId, ...patch } = input;
      await db.update(baasNodes).set({ ...patch, updatedAt: new Date() }).where(eq(baasNodes.id, nodeId));
    }),

  deregister: adminProcedure
    .input(z.object({ nodeId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const active = await db.select().from(baasProjects)
        .where(eq(baasProjects.nodeId, input.nodeId));
      if (active.length) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot deregister: ${active.length} active project(s) on this node`,
        });
      }
      await db.delete(baasNodes).where(eq(baasNodes.id, input.nodeId));
    }),
});
