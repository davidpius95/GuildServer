import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc";
import { db, baasBackups } from "@guildserver/baas-db";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { Queue } from "bullmq";

const backupQueue = new Queue("baas-backup", {
  connection: { host: process.env.REDIS_HOST ?? "localhost", port: parseInt(process.env.REDIS_PORT ?? "6379") },
});

export const baasBackupRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.select().from(baasBackups)
        .where(eq(baasBackups.projectId, input.projectId))
        .orderBy(desc(baasBackups.createdAt))
        .limit(50);
    }),

  createManual: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await backupQueue.add("create", { projectId: input.projectId, backupType: "manual" });
    }),

  restore: protectedProcedure
    .input(z.object({ backupId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [backup] = await db.select().from(baasBackups).where(eq(baasBackups.id, input.backupId));
      if (!backup) throw new TRPCError({ code: "NOT_FOUND" });
      await backupQueue.add("restore", { backupId: input.backupId });
    }),

  restorePitr: protectedProcedure
    .input(z.object({
      projectId:  z.string().uuid(),
      targetTime: z.string().datetime(),
    }))
    .mutation(async ({ input }) => {
      await backupQueue.add("restore-pitr", {
        projectId:  input.projectId,
        targetTime: input.targetTime,
      });
    }),
});
