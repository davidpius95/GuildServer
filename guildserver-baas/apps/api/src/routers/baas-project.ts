import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc";
import { db, baasProjects, baasCustomHostnames } from "@guildserver/baas-db";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { Queue } from "bullmq";

const provisionQueue = new Queue("baas-provision", {
  connection: { host: process.env.REDIS_HOST ?? "localhost", port: parseInt(process.env.REDIS_PORT ?? "6379") },
});

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    + "-" + Math.random().toString(36).slice(2, 7);
}

export const baasProjectRouter = router({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.select().from(baasProjects)
        .where(eq(baasProjects.organizationId, input.organizationId))
        .orderBy(desc(baasProjects.createdAt));
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const hostnames = await db.select().from(baasCustomHostnames).where(eq(baasCustomHostnames.projectId, input.projectId));
      return { ...project, customHostnames: hostnames };
    }),

  create: protectedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      name:           z.string().min(1).max(64),
      region:         z.string().optional(),
      ramMbLimit:     z.number().int().min(512).default(2048),
      vcpuLimit:      z.number().min(0.5).default(1),
      storageGbLimit: z.number().int().min(1).default(8),
    }))
    .mutation(async ({ input }) => {
      const slug   = slugify(input.name);
      const dbName = slug.replace(/-/g, "_");
      const dbUser = `user_${slug.replace(/-/g, "_")}`.slice(0, 32);

      const [project] = await db.insert(baasProjects).values({
        name:           input.name,
        slug,
        organizationId: input.organizationId,
        dbName,
        dbUser,
        dbPassword:     "pending",
        jwtSecret:      "pending",
        anonKey:        "pending",
        serviceRoleKey: "pending",
        ramMbLimit:     input.ramMbLimit,
        vcpuLimit:      String(input.vcpuLimit),
        storageGbLimit: input.storageGbLimit,
        status:         "provisioning",
      }).returning();

      await provisionQueue.add("provision", {
        projectId:      project.id,
        slug,
        organizationId: input.organizationId,
        dbName,
        dbUser,
        ramMbLimit:     input.ramMbLimit,
        vcpuLimit:      input.vcpuLimit,
        storageGbLimit: input.storageGbLimit,
      });

      return project;
    }),

  update: protectedProcedure
    .input(z.object({
      projectId:            z.string().uuid(),
      name:                 z.string().min(1).optional(),
      backupEnabled:        z.boolean().optional(),
      backupRetentionDays:  z.number().int().min(1).max(365).optional(),
      idleTimeoutMinutes:   z.number().int().min(5).max(1440).nullable().optional(),
      walArchiveEnabled:    z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { projectId, ...patch } = input;
      await db.update(baasProjects).set({ ...patch, updatedAt: new Date() }).where(eq(baasProjects.id, projectId));
    }),

  pause: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await provisionQueue.add("pause", { projectId: input.projectId });
    }),

  resume: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await provisionQueue.add("resume", { projectId: input.projectId });
    }),

  // Called by auto-wake: wakes a paused project when a request arrives
  wake: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      if (project.status === "active") return { status: "already_active" };
      if (project.status !== "paused")  return { status: project.status };
      await provisionQueue.add("resume", { projectId: input.projectId }, { priority: 1 });
      return { status: "waking" };
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.update(baasProjects)
        .set({ status: "deleting", updatedAt: new Date() })
        .where(eq(baasProjects.id, input.projectId));
      await provisionQueue.add("delete", { projectId: input.projectId });
    }),

  connectionInfo: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [p] = await db.select().from(baasProjects).where(eq(baasProjects.id, input.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        projectUrl:       p.apiUrl,
        anonKey:          p.anonKey,
        serviceRoleKey:   p.serviceRoleKey,
        dbConnectionString: p.dbHost
          ? `postgresql://${p.dbUser}:${p.dbPassword}@${p.dbHost}:${p.hostPortBase ? p.hostPortBase + 3 : 5432}/${p.dbName}`
          : null,
        studioUrl: p.studioUrl,
      };
    }),
});
