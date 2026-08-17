import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { computeSecurityPosture } from "../services/security-scanner";

export const securityRouter = createTRPCRouter({
  // Live security posture computed from the org's real infrastructure.
  getPosture: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return computeSecurityPosture(input.organizationId);
    }),

  // Re-run the live scan and return a summary.
  startScan: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const posture = await computeSecurityPosture(input.organizationId);
      return {
        id: `scan-${Date.now()}`,
        status: "completed" as const,
        target: "All resources",
        type: "full",
        issuesFound: posture.totalIssues,
        startedAt: posture.lastScan,
        completedAt: new Date().toISOString(),
      };
    }),

  // History persistence isn't modelled yet; return the latest live scan as one entry.
  listScans: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      const posture = await computeSecurityPosture(input.organizationId);
      return [
        {
          id: "scan-live",
          status: "completed",
          target: "All resources",
          type: "full",
          issuesFound: posture.totalIssues,
          startedAt: posture.lastScan,
          completedAt: posture.lastScan,
        },
      ];
    }),

  // Kept for the UI contract — report export is not implemented yet (button disabled).
  exportReport: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), format: z.enum(["pdf", "csv", "json"]) }))
    .mutation(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Report export is coming soon." });
    }),

  // Kept for the UI contract — auto-remediation is not implemented yet (button disabled).
  remediate: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), issueId: z.string() }))
    .mutation(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Auto-remediation is coming soon." });
    }),
});
