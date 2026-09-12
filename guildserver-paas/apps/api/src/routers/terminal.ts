import { z } from "zod";
import { issueDatabaseTunnelTicket } from "../services/database-tunnel";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { issueTerminalTicket, terminalTargetSchema } from "../services/container-terminal";
export const terminalRouter = createTRPCRouter({
  databaseTunnel: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ ctx, input }) => issueDatabaseTunnelTicket(ctx.user.id, input.id)),
  ticket: protectedProcedure.input(terminalTargetSchema).mutation(({ ctx, input }) => issueTerminalTicket(ctx.user.id, input)),
});
