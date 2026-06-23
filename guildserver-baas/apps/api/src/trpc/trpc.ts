import { initTRPC, TRPCError } from "@trpc/server";
import { BaasContext } from "./context";

const t = initTRPC.context<BaasContext>().create();

export const router    = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, userId: ctx.userId! } });
});

export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});
