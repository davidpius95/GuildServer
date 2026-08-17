import Stripe from "stripe";
import { db, subscriptions, plans, invoices, paymentMethods } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { requireStripe } from "./client";
import { getOrCreateCustomerId } from "./customers";

export async function createCheckoutSession(
  organizationId: string,
  planSlug: "pro" | "enterprise",
  billingInterval: "monthly" | "yearly" = "monthly",
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const s = requireStripe();
  const customerId = await getOrCreateCustomerId(organizationId);

  const plan = await db.query.plans.findFirst({ where: eq(plans.slug, planSlug) });
  if (!plan) throw new Error(`Plan '${planSlug}' not found`);

  const priceId = billingInterval === "yearly" ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;
  if (!priceId) throw new Error(`No Stripe price ID configured for ${planSlug} (${billingInterval})`);

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { organizationId, planSlug },
    subscription_data: { metadata: { organizationId, planSlug } },
  });

  if (!session.url) throw new Error("Failed to create Stripe Checkout session");

  logger.info(`Created Checkout session for org ${organizationId} → ${planSlug}`);
  return session.url;
}

/**
 * Create a Stripe Checkout session to subscribe to a single VPS instance.
 * Returns the checkout URL. Throws if the instance type has no Stripe price.
 */
export async function createInstanceCheckoutSession(args: {
  organizationId: string;
  instanceId: string;
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const s = requireStripe();
  const customerId = await getOrCreateCustomerId(args.organizationId);

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: args.stripePriceId, quantity: 1 }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    metadata: { organizationId: args.organizationId, instanceId: args.instanceId, kind: "instance" },
    subscription_data: {
      metadata: { organizationId: args.organizationId, instanceId: args.instanceId, kind: "instance" },
    },
  });

  if (!session.url) throw new Error("Failed to create Stripe Checkout session");
  logger.info(`Created instance Checkout session for org ${args.organizationId} → instance ${args.instanceId}`);
  return session.url;
}

export async function createPortalSession(organizationId: string, returnUrl: string): Promise<string> {
  const s = requireStripe();
  const customerId = await getOrCreateCustomerId(organizationId);
  const session = await s.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

export async function cancelSubscription(organizationId: string, immediate = false): Promise<void> {
  const s = requireStripe();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub || !sub.stripeSubscriptionId) throw new Error("No active Stripe subscription found");

  if (immediate) {
    await s.subscriptions.cancel(sub.stripeSubscriptionId);
  } else {
    await s.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
  }

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: !immediate, status: immediate ? "canceled" : sub.status, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  logger.info(`Canceled subscription for org ${organizationId} (immediate: ${immediate})`);
}

export async function resumeSubscription(organizationId: string): Promise<void> {
  const s = requireStripe();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub || !sub.stripeSubscriptionId) throw new Error("No active Stripe subscription found");

  await s.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false });
  await db.update(subscriptions).set({ cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));

  logger.info(`Resumed subscription for org ${organizationId}`);
}

export async function changeSubscription(
  organizationId: string,
  newPlanSlug: "pro" | "enterprise",
  billingInterval: "monthly" | "yearly" = "monthly"
): Promise<void> {
  const s = requireStripe();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub || !sub.stripeSubscriptionId) throw new Error("No active Stripe subscription found");

  const newPlan = await db.query.plans.findFirst({ where: eq(plans.slug, newPlanSlug) });
  if (!newPlan) throw new Error(`Plan '${newPlanSlug}' not found`);

  const priceId = billingInterval === "yearly" ? newPlan.stripePriceIdYearly : newPlan.stripePriceIdMonthly;
  if (!priceId) throw new Error(`No Stripe price ID configured for ${newPlanSlug} (${billingInterval})`);

  const stripeSub = await s.subscriptions.retrieve(sub.stripeSubscriptionId);
  const currentItemId = stripeSub.items.data[0]?.id;
  if (!currentItemId) throw new Error("No subscription item found");

  await s.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: currentItemId, price: priceId }],
    proration_behavior: "create_prorations",
    metadata: { planSlug: newPlanSlug },
  });

  await db.update(subscriptions).set({ planId: newPlan.id, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));

  logger.info(`Changed subscription for org ${organizationId} to ${newPlanSlug}`);
}

export async function reportUsageToStripe(
  organizationId: string,
  meteredPriceId: string,
  quantity: number
): Promise<void> {
  const s = requireStripe();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub || !sub.stripeSubscriptionId) return;

  const stripeSub = await s.subscriptions.retrieve(sub.stripeSubscriptionId);
  const meteredItem = stripeSub.items.data.find((item) => item.price.id === meteredPriceId);

  if (meteredItem) {
    // @ts-ignore
    await s.subscriptionItems.createUsageRecord(meteredItem.id, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: "increment",
    });
  }
}

export async function getUpcomingInvoice(organizationId: string): Promise<Stripe.UpcomingInvoice | null> {
  const s = requireStripe();

  const { organizations } = await import("@guildserver/database");
  const { eq: eqOp } = await import("drizzle-orm");
  const org = await db.query.organizations.findFirst({ where: eqOp(organizations.id, organizationId) });

  if (!org?.stripeCustomerId) return null;

  try {
    // @ts-ignore
    return await s.invoices.retrieveUpcoming({ customer: org.stripeCustomerId });
  } catch {
    return null;
  }
}

export async function listInvoices(
  organizationId: string,
  limit = 20
): Promise<typeof invoices.$inferSelect[]> {
  return db.query.invoices.findMany({
    where: eq(invoices.organizationId, organizationId),
    orderBy: (inv, { desc }) => [desc(inv.createdAt)],
    limit,
  });
}

export async function createSetupIntent(organizationId: string): Promise<string> {
  const s = requireStripe();
  const customerId = await getOrCreateCustomerId(organizationId);
  const intent = await s.setupIntents.create({ customer: customerId, payment_method_types: ["card"] });
  return intent.client_secret!;
}

export async function getPaymentMethods(
  organizationId: string
): Promise<typeof paymentMethods.$inferSelect[]> {
  return db.query.paymentMethods.findMany({
    where: eq(paymentMethods.organizationId, organizationId),
    orderBy: (pm, { desc }) => [desc(pm.createdAt)],
  });
}
