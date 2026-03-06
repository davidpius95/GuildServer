import Stripe from "stripe";
import { db, organizations, subscriptions, invoices, paymentMethods, plans } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

// Initialize Stripe client — only if STRIPE_SECRET_KEY is available
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" as any })
  : null;

/**
 * Check if Stripe is configured and ready to use
 */
export function isStripeConfigured(): boolean {
  return stripe !== null;
}

/**
 * Ensure Stripe is configured before making API calls.
 * Throws a user-friendly error if not configured.
 */
function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.");
  }
  return stripe;
}

// =====================
// CUSTOMER MANAGEMENT
// =====================

/**
 * Create a Stripe customer for an organization.
 * Saves the stripeCustomerId back to the organizations table.
 */
export async function createCustomer(organizationId: string): Promise<string> {
  const s = requireStripe();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!org) throw new Error(`Organization ${organizationId} not found`);

  // Return existing customer if already created
  if (org.stripeCustomerId) {
    return org.stripeCustomerId;
  }

  const customer = await s.customers.create({
    name: org.name,
    metadata: {
      organizationId: org.id,
      organizationSlug: org.slug,
    },
  });

  // Save to DB
  await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizations.id, organizationId));

  logger.info(`Created Stripe customer ${customer.id} for org ${org.name}`);
  return customer.id;
}

/**
 * Get or create a Stripe customer ID for an organization.
 */
export async function getOrCreateCustomerId(organizationId: string): Promise<string> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!org) throw new Error(`Organization ${organizationId} not found`);
  if (org.stripeCustomerId) return org.stripeCustomerId;

  return createCustomer(organizationId);
}

// =====================
// SUBSCRIPTION MANAGEMENT
// =====================

/**
 * Create a Stripe Checkout session for upgrading to a paid plan.
 * Returns the Checkout URL to redirect the user to.
 */
export async function createCheckoutSession(
  organizationId: string,
  planSlug: "pro" | "enterprise",
  billingInterval: "monthly" | "yearly" = "monthly",
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const s = requireStripe();

  const customerId = await getOrCreateCustomerId(organizationId);

  // Get the target plan
  const plan = await db.query.plans.findFirst({
    where: eq(plans.slug, planSlug),
  });

  if (!plan) throw new Error(`Plan '${planSlug}' not found`);

  const priceId =
    billingInterval === "yearly" ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;

  if (!priceId) {
    throw new Error(`No Stripe price ID configured for ${planSlug} (${billingInterval})`);
  }

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      organizationId,
      planSlug,
    },
    subscription_data: {
      metadata: {
        organizationId,
        planSlug,
      },
    },
  });

  if (!session.url) throw new Error("Failed to create Stripe Checkout session");

  logger.info(`Created Checkout session for org ${organizationId} → ${planSlug}`);
  return session.url;
}

/**
 * Create a Stripe Customer Portal session for self-service billing management.
 * Returns the Portal URL.
 */
export async function createPortalSession(
  organizationId: string,
  returnUrl: string
): Promise<string> {
  const s = requireStripe();

  const customerId = await getOrCreateCustomerId(organizationId);

  const session = await s.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Cancel a subscription (at period end by default).
 */
export async function cancelSubscription(
  organizationId: string,
  immediate: boolean = false
): Promise<void> {
  const s = requireStripe();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub || !sub.stripeSubscriptionId) {
    throw new Error("No active Stripe subscription found");
  }

  if (immediate) {
    await s.subscriptions.cancel(sub.stripeSubscriptionId);
  } else {
    await s.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: !immediate,
      status: immediate ? "canceled" : sub.status,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  logger.info(`Canceled subscription for org ${organizationId} (immediate: ${immediate})`);
}

/**
 * Resume a canceled subscription (if cancelAtPeriodEnd was true).
 */
export async function resumeSubscription(organizationId: string): Promise<void> {
  const s = requireStripe();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub || !sub.stripeSubscriptionId) {
    throw new Error("No active Stripe subscription found");
  }

  await s.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  logger.info(`Resumed subscription for org ${organizationId}`);
}

/**
 * Change a subscription to a different plan (upgrade/downgrade).
 * Uses Stripe proration.
 */
export async function changeSubscription(
  organizationId: string,
  newPlanSlug: "pro" | "enterprise",
  billingInterval: "monthly" | "yearly" = "monthly"
): Promise<void> {
  const s = requireStripe();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub || !sub.stripeSubscriptionId) {
    throw new Error("No active Stripe subscription found");
  }

  const newPlan = await db.query.plans.findFirst({
    where: eq(plans.slug, newPlanSlug),
  });

  if (!newPlan) throw new Error(`Plan '${newPlanSlug}' not found`);

  const priceId =
    billingInterval === "yearly" ? newPlan.stripePriceIdYearly : newPlan.stripePriceIdMonthly;

  if (!priceId) {
    throw new Error(`No Stripe price ID configured for ${newPlanSlug} (${billingInterval})`);
  }

  // Get current subscription items from Stripe
  const stripeSub = await s.subscriptions.retrieve(sub.stripeSubscriptionId);
  const currentItemId = stripeSub.items.data[0]?.id;

  if (!currentItemId) throw new Error("No subscription item found");

  // Update the subscription with the new price
  await s.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: currentItemId, price: priceId }],
    proration_behavior: "create_prorations",
    metadata: { planSlug: newPlanSlug },
  });

  // Update local DB
  await db
    .update(subscriptions)
    .set({
      planId: newPlan.id,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  logger.info(`Changed subscription for org ${organizationId} to ${newPlanSlug}`);
}

// =====================
// USAGE REPORTING
// =====================

/**
 * Report metered usage to Stripe.
 */
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

  // Find the metered subscription item
  const meteredItem = stripeSub.items.data.find(
    (item) => item.price.id === meteredPriceId
  );

  if (meteredItem) {
    await s.subscriptionItems.createUsageRecord(meteredItem.id, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: "increment",
    });
  }
}

// =====================
// INVOICE MANAGEMENT
// =====================

/**
 * Get the upcoming invoice preview for an organization.
 */
export async function getUpcomingInvoice(organizationId: string): Promise<Stripe.UpcomingInvoice | null> {
  const s = requireStripe();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!org?.stripeCustomerId) return null;

  try {
    return await s.invoices.retrieveUpcoming({
      customer: org.stripeCustomerId,
    });
  } catch {
    return null;
  }
}

/**
 * List invoices for an organization from local DB.
 */
export async function listInvoices(
  organizationId: string,
  limit: number = 20
): Promise<typeof invoices.$inferSelect[]> {
  return db.query.invoices.findMany({
    where: eq(invoices.organizationId, organizationId),
    orderBy: (inv, { desc }) => [desc(inv.createdAt)],
    limit,
  });
}

// =====================
// PAYMENT METHODS
// =====================

/**
 * Create a Setup Intent for adding a payment method.
 */
export async function createSetupIntent(organizationId: string): Promise<string> {
  const s = requireStripe();

  const customerId = await getOrCreateCustomerId(organizationId);

  const intent = await s.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
  });

  return intent.client_secret!;
}

/**
 * Get payment methods for an organization from local DB.
 */
export async function getPaymentMethods(
  organizationId: string
): Promise<typeof paymentMethods.$inferSelect[]> {
  return db.query.paymentMethods.findMany({
    where: eq(paymentMethods.organizationId, organizationId),
    orderBy: (pm, { desc }) => [desc(pm.createdAt)],
  });
}

// =====================
// WEBHOOK SYNC HELPERS
// =====================

/**
 * Sync a Stripe subscription event to local DB.
 * Called from webhook handler.
 */
export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription
): Promise<void> {
  const organizationId = stripeSubscription.metadata?.organizationId;
  const planSlug = stripeSubscription.metadata?.planSlug;

  if (!organizationId) {
    logger.warn("Stripe subscription missing organizationId metadata", {
      subscriptionId: stripeSubscription.id,
    });
    return;
  }

  // Get the plan
  let plan = null;
  if (planSlug) {
    plan = await db.query.plans.findFirst({
      where: eq(plans.slug, planSlug as any),
    });
  }

  // Find existing local subscription
  const existingSub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  const subData = {
    stripeCustomerId: stripeSubscription.customer as string,
    stripeSubscriptionId: stripeSubscription.id,
    status: mapStripeStatus(stripeSubscription.status),
    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    trialStart: stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : null,
    trialEnd: stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : null,
    updatedAt: new Date(),
  };

  if (existingSub) {
    await db
      .update(subscriptions)
      .set({
        ...subData,
        ...(plan ? { planId: plan.id } : {}),
      })
      .where(eq(subscriptions.id, existingSub.id));
  } else if (plan) {
    await db.insert(subscriptions).values({
      organizationId,
      planId: plan.id,
      ...subData,
    });
  }

  // Update org's stripeCustomerId
  await db
    .update(organizations)
    .set({ stripeCustomerId: stripeSubscription.customer as string })
    .where(eq(organizations.id, organizationId));

  logger.info(`Synced subscription ${stripeSubscription.id} for org ${organizationId}`);
}

/**
 * Sync a Stripe invoice event to local DB.
 */
export async function syncInvoiceFromStripe(stripeInvoice: Stripe.Invoice): Promise<void> {
  const customerId = stripeInvoice.customer as string;

  // Find the org by stripe customer ID
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) {
    logger.warn(`No org found for Stripe customer ${customerId}`);
    return;
  }

  // Find existing invoice
  const existingInvoice = await db.query.invoices.findFirst({
    where: eq(invoices.stripeInvoiceId, stripeInvoice.id),
  });

  const invoiceData = {
    organizationId: org.id,
    stripeInvoiceId: stripeInvoice.id,
    number: stripeInvoice.number,
    status: mapInvoiceStatus(stripeInvoice.status),
    amountDueCents: stripeInvoice.amount_due,
    amountPaidCents: stripeInvoice.amount_paid,
    currency: stripeInvoice.currency,
    periodStart: stripeInvoice.period_start
      ? new Date(stripeInvoice.period_start * 1000)
      : null,
    periodEnd: stripeInvoice.period_end
      ? new Date(stripeInvoice.period_end * 1000)
      : null,
    invoiceUrl: stripeInvoice.hosted_invoice_url,
    pdfUrl: stripeInvoice.invoice_pdf,
    paidAt: stripeInvoice.status === "paid" ? new Date() : null,
  };

  if (existingInvoice) {
    await db
      .update(invoices)
      .set(invoiceData)
      .where(eq(invoices.id, existingInvoice.id));
  } else {
    await db.insert(invoices).values(invoiceData);
  }
}

/**
 * Sync a payment method from Stripe.
 */
export async function syncPaymentMethodFromStripe(
  stripePaymentMethod: Stripe.PaymentMethod,
  action: "attached" | "detached"
): Promise<void> {
  if (action === "detached") {
    // Remove from local DB
    await db
      .delete(paymentMethods)
      .where(eq(paymentMethods.stripePaymentMethodId, stripePaymentMethod.id));
    return;
  }

  const customerId = stripePaymentMethod.customer as string;
  if (!customerId) return;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) return;

  const card = stripePaymentMethod.card;
  if (!card) return;

  // Check if already exists
  const existing = await db.query.paymentMethods.findFirst({
    where: eq(paymentMethods.stripePaymentMethodId, stripePaymentMethod.id),
  });

  if (!existing) {
    await db.insert(paymentMethods).values({
      organizationId: org.id,
      stripePaymentMethodId: stripePaymentMethod.id,
      type: "card",
      cardBrand: card.brand,
      cardLast4: card.last4,
      cardExpMonth: card.exp_month,
      cardExpYear: card.exp_year,
      isDefault: false,
    });
  }
}

/**
 * Handle subscription deletion — downgrade to Hobby.
 */
export async function handleSubscriptionDeleted(
  stripeSubscription: Stripe.Subscription
): Promise<void> {
  const organizationId = stripeSubscription.metadata?.organizationId;
  if (!organizationId) return;

  const hobbyPlan = await db.query.plans.findFirst({
    where: eq(plans.slug, "hobby"),
  });

  if (!hobbyPlan) return;

  const existingSub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (existingSub) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await db
      .update(subscriptions)
      .set({
        planId: hobbyPlan.id,
        status: "active",
        stripeSubscriptionId: null,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        trialStart: null,
        trialEnd: null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existingSub.id));
  }

  logger.info(`Downgraded org ${organizationId} to Hobby after subscription deletion`);
}

// =====================
// HELPERS
// =====================

function mapStripeStatus(status: Stripe.Subscription.Status): string {
  const mapping: Record<string, string> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "past_due",
    incomplete: "incomplete",
    incomplete_expired: "canceled",
    paused: "paused",
  };
  return mapping[status] || "active";
}

function mapInvoiceStatus(status: string | null): string {
  if (!status) return "draft";
  const mapping: Record<string, string> = {
    draft: "draft",
    open: "open",
    paid: "paid",
    void: "void",
    uncollectible: "uncollectible",
  };
  return mapping[status] || "draft";
}
