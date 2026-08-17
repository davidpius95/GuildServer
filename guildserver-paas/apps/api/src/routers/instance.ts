import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { instances, instanceTypes, members } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { isStripeConfigured, createInstanceCheckoutSession, stripe } from "../services/billing";
import { addInstanceProvisionJob, addInstanceDestroyJob } from "../queues/instances";
import { logger } from "../utils/logger";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Add-on pricing (cents)
const STORAGE_PRICE_PER_GB = 10;   // $0.10 / GB / mo block storage
const BACKUPS_PRICE_RATIO = 0.2;   // backups = +20% of instance price

/** Throw unless the current user belongs to the organization. */
async function assertOrgMember(ctx: any, organizationId: string) {
  const membership = await ctx.db.query.members.findFirst({
    where: and(
      eq(members.organizationId, organizationId),
      eq(members.userId, ctx.user.id),
    ),
  });
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this organization" });
  }
  return membership;
}

/** Monthly cost in cents for an instance type plus add-ons. */
function estimateMonthlyCents(
  typePriceMonthly: number,
  extraStorageGb: number,
  backupsEnabled: boolean,
): number {
  const storage = Math.max(0, extraStorageGb) * STORAGE_PRICE_PER_GB;
  const backups = backupsEnabled ? Math.round(typePriceMonthly * BACKUPS_PRICE_RATIO) : 0;
  return typePriceMonthly + storage + backups;
}

export const instanceRouter = createTRPCRouter({
  // List instances for an organization
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOrgMember(ctx, input.organizationId);

      return ctx.db.query.instances.findMany({
        where: eq(instances.organizationId, input.organizationId),
        with: { instanceType: true },
        orderBy: (i, { desc: d }) => [d(i.createdAt)],
      });
    }),

  // Estimate the monthly/hourly cost of a configuration (no side effects)
  estimate: protectedProcedure
    .input(
      z.object({
        instanceTypeId: z.string().uuid(),
        extraStorageGb: z.number().int().min(0).max(10000).default(0),
        backupsEnabled: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const type = await ctx.db.query.instanceTypes.findFirst({
        where: eq(instanceTypes.id, input.instanceTypeId),
      });
      if (!type) throw new TRPCError({ code: "NOT_FOUND", message: "Instance type not found" });

      const monthlyCents = estimateMonthlyCents(type.priceMonthly, input.extraStorageGb, input.backupsEnabled);
      return {
        monthlyCents,
        hourlyCents: monthlyCents / 730,
      };
    }),

  // Provision a new instance
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        instanceTypeId: z.string().uuid(),
        name: z.string().min(1).max(255),
        region: z.string().max(64).default("default"),
        billingPeriod: z.enum(["monthly", "hourly"]).default("monthly"),
        extraStorageGb: z.number().int().min(0).max(10000).default(0),
        backupsEnabled: z.boolean().default(false),
        providerId: z.string().uuid().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgMember(ctx, input.organizationId);

      const type = await ctx.db.query.instanceTypes.findFirst({
        where: and(eq(instanceTypes.id, input.instanceTypeId), eq(instanceTypes.isActive, true)),
      });
      if (!type) throw new TRPCError({ code: "NOT_FOUND", message: "Instance type not found" });

      const [instance] = await ctx.db
        .insert(instances)
        .values({
          name: input.name,
          organizationId: input.organizationId,
          instanceTypeId: input.instanceTypeId,
          providerId: input.providerId ?? null,
          region: input.region,
          billingPeriod: input.billingPeriod,
          extraStorageGb: input.extraStorageGb,
          backupsEnabled: input.backupsEnabled,
          status: "pending",
          statusMessage: "Awaiting checkout",
        })
        .returning();

      // If Stripe is configured and this type has a price, gate provisioning
      // behind payment: return a Checkout URL; the webhook enqueues provisioning
      // on checkout.session.completed.
      const stripePriceId =
        input.billingPeriod === "hourly" ? type.stripePriceIdHourly : type.stripePriceIdMonthly;

      if (isStripeConfigured() && stripePriceId) {
        try {
          const checkoutUrl = await createInstanceCheckoutSession({
            organizationId: input.organizationId,
            instanceId: instance.id,
            stripePriceId,
            successUrl: `${APP_URL}/dashboard/instances?checkout=success`,
            cancelUrl: `${APP_URL}/dashboard/instances?checkout=cancelled`,
          });
          return { instance, checkoutUrl };
        } catch (err: any) {
          logger.warn(`Instance checkout failed, provisioning without billing: ${err.message}`);
        }
      }

      // Self-hosted / no Stripe price → provision immediately.
      await ctx.db
        .update(instances)
        .set({ statusMessage: "Queued for provisioning", updatedAt: new Date() })
        .where(eq(instances.id, instance.id));
      await addInstanceProvisionJob(instance.id);

      return { instance, checkoutUrl: null };
    }),

  // Destroy an instance
  destroy: protectedProcedure
    .input(z.object({ id: z.string().uuid(), organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOrgMember(ctx, input.organizationId);

      const instance = await ctx.db.query.instances.findFirst({
        where: and(eq(instances.id, input.id), eq(instances.organizationId, input.organizationId)),
      });
      if (!instance) throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });

      // Cancel the Stripe subscription (best-effort) so billing stops.
      if (instance.stripeSubscriptionId && isStripeConfigured() && stripe) {
        try {
          await stripe.subscriptions.cancel(instance.stripeSubscriptionId);
        } catch (err: any) {
          logger.warn(`Failed to cancel instance subscription ${instance.stripeSubscriptionId}: ${err.message}`);
        }
      }

      // Tear down the backing resource asynchronously.
      await ctx.db
        .update(instances)
        .set({ status: "provisioning", statusMessage: "Termination queued", updatedAt: new Date() })
        .where(eq(instances.id, input.id));
      await addInstanceDestroyJob(instance.id);

      return { success: true };
    }),
});
