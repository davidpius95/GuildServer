import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { type Context } from "./context";
import { checkLimit } from "../services/usage-meter";
import { db, members, subscriptions, plans } from "@guildserver/database";
import { eq, and } from "drizzle-orm";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.code === "BAD_REQUEST" && error.cause?.name === "ZodError"
            ? error.cause.flatten()
            : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // user is now non-nullable
    },
  });
});

export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user || !ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// Organization-based authorization middleware
export const organizationProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // This middleware can be extended to check organization membership
  // For now, it just ensures the user is authenticated
  return next({
    ctx,
  });
});

// =====================
// BILLING ENFORCEMENT HELPERS
// =====================

/**
 * Check if a specific usage metric is within plan limits for an organization.
 * For Hobby plan: hard cap (throws FORBIDDEN).
 * For Pro+ plans: allows overages (returns normally).
 *
 * Usage in routers:
 *   await enforcePlanLimit(orgId, "applications");
 *   await enforcePlanLimit(orgId, "deployments");
 */
export async function enforcePlanLimit(
  organizationId: string,
  metric: string
): Promise<void> {
  const result = await checkLimit(organizationId, metric);

  if (result.isUnlimited || result.allowed) return;

  // Get the plan slug to decide behavior
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
    with: { plan: true },
  });

  const planSlug = sub?.plan?.slug || "hobby";

  // Hobby plan: hard cap — block the action
  if (planSlug === "hobby") {
    const friendlyMetric = metric.replace(/_/g, " ");
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You've reached the ${friendlyMetric} limit on the Hobby plan (${result.current}/${result.limit}). Upgrade to Pro for higher limits.`,
    });
  }

  // Pro/Enterprise: allow overages — Stripe metered billing handles costs
}

/**
 * Check if a feature is enabled for an organization's plan.
 * Throws FORBIDDEN with upgrade prompt if the feature is not available.
 *
 * Usage in routers:
 *   await enforceFeature(orgId, "previewDeployments");
 *   await enforceFeature(orgId, "teamCollaboration");
 */
export async function enforceFeature(
  organizationId: string,
  featureName: string
): Promise<void> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
    with: { plan: true },
  });

  const features = (sub?.plan?.features as Record<string, boolean>) || {};
  const planName = sub?.plan?.name || "Hobby";

  if (!features[featureName]) {
    const friendlyFeature = featureName
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (s) => s.toUpperCase())
      .trim();

    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${friendlyFeature} is not available on the ${planName} plan. Upgrade to Pro to access this feature.`,
    });
  }
}

/**
 * Helper to get the organization ID for a user (their first/default org).
 */
export async function getUserOrgId(userId: string): Promise<string | null> {
  const membership = await db.query.members.findFirst({
    where: eq(members.userId, userId),
  });
  return membership?.organizationId || null;
}