import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc/trpc";
import {
  plans,
  subscriptions,
  invoices,
  usageRecords,
  paymentMethods,
  members,
  organizations,
  applications,
  databases as databasesTable,
} from "@guildserver/database";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  isStripeConfigured,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription as stripeCancelSubscription,
  resumeSubscription as stripeResumeSubscription,
} from "../services/stripe";

export const billingRouter = createTRPCRouter({
  /**
   * Get all available plans (public — visible on pricing page).
   */
  getPlans: publicProcedure.query(async ({ ctx }) => {
    const allPlans = await ctx.db.query.plans.findMany({
      where: eq(plans.isActive, true),
      orderBy: (p, { asc }) => [asc(p.sortOrder)],
    });

    return allPlans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      limits: plan.limits as Record<string, number>,
      features: plan.features as Record<string, boolean>,
      sortOrder: plan.sortOrder,
    }));
  }),

  /**
   * Get the current plan for a specific organization.
   * Returns subscription info + plan details.
   */
  getCurrentPlan: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify user is a member of this organization
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      // Get subscription with plan details
      const subscription = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, input.organizationId),
        with: {
          plan: true,
        },
      });

      if (!subscription) {
        // No subscription — return default Hobby info
        const hobbyPlan = await ctx.db.query.plans.findFirst({
          where: eq(plans.slug, "hobby"),
        });

        return {
          plan: hobbyPlan
            ? {
                id: hobbyPlan.id,
                name: hobbyPlan.name,
                slug: hobbyPlan.slug,
                priceMonthly: hobbyPlan.priceMonthly,
                limits: hobbyPlan.limits as Record<string, number>,
                features: hobbyPlan.features as Record<string, boolean>,
              }
            : null,
          subscription: null,
        };
      }

      return {
        plan: {
          id: subscription.plan.id,
          name: subscription.plan.name,
          slug: subscription.plan.slug,
          priceMonthly: subscription.plan.priceMonthly,
          priceYearly: subscription.plan.priceYearly,
          limits: subscription.plan.limits as Record<string, number>,
          features: subscription.plan.features as Record<string, boolean>,
        },
        subscription: {
          id: subscription.id,
          status: subscription.status,
          seats: subscription.seats,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          trialStart: subscription.trialStart,
          trialEnd: subscription.trialEnd,
          spendLimitCents: subscription.spendLimitCents,
          usageCreditCents: subscription.usageCreditCents,
        },
      };
    }),

  /**
   * Get usage data for the current billing period.
   */
  getUsage: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify membership
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      // Get current period dates
      const subscription = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, input.organizationId),
        with: { plan: true },
      });

      // Get usage records for current period
      const usage = await ctx.db.query.usageRecords.findMany({
        where: eq(usageRecords.organizationId, input.organizationId),
        orderBy: (u, { desc }) => [desc(u.createdAt)],
      });

      // Aggregate usage by metric
      const usageMap: Record<string, number> = {};
      for (const record of usage) {
        const metric = record.metric;
        usageMap[metric] = (usageMap[metric] || 0) + Number(record.value);
      }

      const limits = (subscription?.plan?.limits as Record<string, number>) || {};

      // Count actual resources (apps, databases) from the DB
      const appCount = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .where(eq(applications.projectId, sql`(SELECT id FROM projects WHERE organization_id = ${input.organizationId} LIMIT 1)`));

      const dbCount = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(databasesTable)
        .where(eq(databasesTable.projectId, sql`(SELECT id FROM projects WHERE organization_id = ${input.organizationId} LIMIT 1)`));

      return {
        metrics: {
          deployments: {
            current: usageMap["deployments"] || 0,
            limit: limits.maxDeployments ?? 50,
            unit: "deployments",
          },
          bandwidth_gb: {
            current: usageMap["bandwidth_gb"] || 0,
            limit: limits.maxBandwidthGb ?? 10,
            unit: "GB",
          },
          build_minutes: {
            current: usageMap["build_minutes"] || 0,
            limit: limits.maxBuildMinutes ?? 100,
            unit: "minutes",
          },
          applications: {
            current: appCount[0]?.count || 0,
            limit: limits.maxApps ?? 3,
            unit: "apps",
          },
          databases: {
            current: dbCount[0]?.count || 0,
            limit: limits.maxDatabases ?? 1,
            unit: "databases",
          },
        },
        periodStart: subscription?.currentPeriodStart || null,
        periodEnd: subscription?.currentPeriodEnd || null,
      };
    }),

  /**
   * Get invoices for an organization.
   */
  getInvoices: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify membership (owner or billing role)
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      const orgInvoices = await ctx.db.query.invoices.findMany({
        where: eq(invoices.organizationId, input.organizationId),
        orderBy: (inv, { desc }) => [desc(inv.createdAt)],
        limit: input.limit,
      });

      return orgInvoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountDueCents: inv.amountDueCents,
        amountPaidCents: inv.amountPaidCents,
        currency: inv.currency,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        invoiceUrl: inv.invoiceUrl,
        pdfUrl: inv.pdfUrl,
        paidAt: inv.paidAt,
        createdAt: inv.createdAt,
      }));
    }),

  /**
   * Get payment methods for an organization.
   */
  getPaymentMethods: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify membership
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      const methods = await ctx.db.query.paymentMethods.findMany({
        where: eq(paymentMethods.organizationId, input.organizationId),
        orderBy: (pm, { desc }) => [desc(pm.createdAt)],
      });

      return methods.map((pm) => ({
        id: pm.id,
        type: pm.type,
        cardBrand: pm.cardBrand,
        cardLast4: pm.cardLast4,
        cardExpMonth: pm.cardExpMonth,
        cardExpYear: pm.cardExpYear,
        isDefault: pm.isDefault,
        createdAt: pm.createdAt,
      }));
    }),

  // =====================
  // MUTATIONS
  // =====================

  /**
   * Create a Stripe Checkout session to upgrade to a paid plan.
   * Returns the Checkout URL to redirect the user to.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        planSlug: z.enum(["pro", "enterprise"]),
        billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isStripeConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe is not configured. Contact your administrator.",
        });
      }

      // Verify owner/admin membership
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || !["owner", "admin"].includes(member.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization owners or admins can manage billing",
        });
      }

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const successUrl = `${frontendUrl}/dashboard/billing?success=true`;
      const cancelUrl = `${frontendUrl}/dashboard/billing?canceled=true`;

      const url = await createCheckoutSession(
        input.organizationId,
        input.planSlug,
        input.billingInterval,
        successUrl,
        cancelUrl
      );

      return { url };
    }),

  /**
   * Create a Stripe Customer Portal session for self-service billing.
   */
  createPortalSession: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!isStripeConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe is not configured.",
        });
      }

      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || !["owner", "admin"].includes(member.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization owners or admins can manage billing",
        });
      }

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const url = await createPortalSession(
        input.organizationId,
        `${frontendUrl}/dashboard/billing`
      );

      return { url };
    }),

  /**
   * Cancel the current subscription (at period end).
   */
  cancelSubscription: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        immediate: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || member.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the organization owner can cancel the subscription",
        });
      }

      await stripeCancelSubscription(input.organizationId, input.immediate);
      return { success: true };
    }),

  /**
   * Resume a canceled subscription.
   */
  resumeSubscription: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || member.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the organization owner can manage the subscription",
        });
      }

      await stripeResumeSubscription(input.organizationId);
      return { success: true };
    }),

  /**
   * Set a monthly spend limit (Pro+ only).
   */
  setSpendLimit: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        spendLimitCents: z.number().min(0).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || !["owner", "admin"].includes(member.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only owners or admins can set spend limits",
        });
      }

      const sub = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, input.organizationId),
      });

      if (!sub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No subscription found",
        });
      }

      await ctx.db
        .update(subscriptions)
        .set({
          spendLimitCents: input.spendLimitCents,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      return { success: true };
    }),

  /**
   * Get spend status for an organization (Pro+ only).
   * Returns current overage costs vs spend limit.
   */
  getSpendStatus: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      // Dynamically import to avoid circular deps
      const { calculateOverageCost, checkSpendLimit } = await import("../services/spend-manager");

      const [overageCost, spendCheck] = await Promise.all([
        calculateOverageCost(input.organizationId),
        checkSpendLimit(input.organizationId),
      ]);

      return {
        currentSpendCents: spendCheck.currentSpendCents,
        limitCents: spendCheck.limitCents,
        percentage: spendCheck.percentage,
        allowed: spendCheck.allowed,
        overage: overageCost,
      };
    }),

  /**
   * Start a 14-day Pro trial (one per organization).
   */
  startTrial: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.user.id),
          eq(members.organizationId, input.organizationId)
        ),
      });

      if (!member || member.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the organization owner can start a trial",
        });
      }

      // Check trial eligibility
      const sub = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, input.organizationId),
      });

      if (sub?.trialStart) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This organization has already used its free trial",
        });
      }

      // Get Pro plan
      const proPlan = await ctx.db.query.plans.findFirst({
        where: eq(plans.slug, "pro"),
      });

      if (!proPlan) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Pro plan not found",
        });
      }

      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 14);

      if (sub) {
        await ctx.db
          .update(subscriptions)
          .set({
            planId: proPlan.id,
            status: "trialing",
            trialStart: now,
            trialEnd: trialEnd,
            currentPeriodStart: now,
            currentPeriodEnd: trialEnd,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));
      } else {
        await ctx.db.insert(subscriptions).values({
          organizationId: input.organizationId,
          planId: proPlan.id,
          status: "trialing",
          trialStart: now,
          trialEnd: trialEnd,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
          seats: 1,
        });
      }

      return { success: true, trialEnd };
    }),
});
