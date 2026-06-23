import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc";
import { db, baasMetrics } from "@guildserver/baas-db";
import { eq, desc, gte, and } from "drizzle-orm";

export const baasMetricsRouter = router({
  // Latest N rows for a project (dashboard overview cards)
  latest: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      return db.select().from(baasMetrics)
        .where(eq(baasMetrics.projectId, input.projectId))
        .orderBy(desc(baasMetrics.collectedAt))
        .limit(input.limit);
    }),

  // Time-range query for charts (last 1h, 6h, 24h, 7d)
  range: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      from:      z.string().datetime(),
      to:        z.string().datetime().optional(),
    }))
    .query(async ({ input }) => {
      const from = new Date(input.from);
      const to   = input.to ? new Date(input.to) : new Date();
      return db.select().from(baasMetrics)
        .where(
          and(
            eq(baasMetrics.projectId, input.projectId),
            gte(baasMetrics.collectedAt, from),
          )
        )
        .orderBy(baasMetrics.collectedAt)
        .limit(1000);
    }),
});
