import Stripe from "stripe";
import { db, organizations, subscriptions, invoices, paymentMethods, plans } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { mapStripeStatus, mapInvoiceStatus } from "./client";

export async function syncSubscriptionFromStripe(stripeSubscription: Stripe.Subscription): Promise<void> {
  const organizationId = stripeSubscription.metadata?.organizationId;
  const planSlug = stripeSubscription.metadata?.planSlug;

  if (!organizationId) {
    logger.warn("Stripe subscription missing organizationId metadata", { subscriptionId: stripeSubscription.id });
    return;
  }

  let plan = null;
  if (planSlug) {
    plan = await db.query.plans.findFirst({ where: eq(plans.slug, planSlug as any) });
  }

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
    trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
    trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
    updatedAt: new Date(),
  };

  if (existingSub) {
    await db
      .update(subscriptions)
      .set({ ...subData, ...(plan ? { planId: plan.id } : {}) })
      .where(eq(subscriptions.id, existingSub.id));
  } else if (plan) {
    await db.insert(subscriptions).values({ organizationId, planId: plan.id, ...subData });
  }

  await db
    .update(organizations)
    .set({ stripeCustomerId: stripeSubscription.customer as string })
    .where(eq(organizations.id, organizationId));

  logger.info(`Synced subscription ${stripeSubscription.id} for org ${organizationId}`);
}

export async function syncInvoiceFromStripe(stripeInvoice: Stripe.Invoice): Promise<void> {
  const customerId = stripeInvoice.customer as string;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerId),
  });

  if (!org) {
    logger.warn(`No org found for Stripe customer ${customerId}`);
    return;
  }

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
    periodStart: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000) : null,
    periodEnd: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : null,
    invoiceUrl: stripeInvoice.hosted_invoice_url,
    pdfUrl: stripeInvoice.invoice_pdf,
    paidAt: stripeInvoice.status === "paid" ? new Date() : null,
  };

  if (existingInvoice) {
    await db.update(invoices).set(invoiceData).where(eq(invoices.id, existingInvoice.id));
  } else {
    await db.insert(invoices).values(invoiceData);
  }
}

export async function syncPaymentMethodFromStripe(
  stripePaymentMethod: Stripe.PaymentMethod,
  action: "attached" | "detached"
): Promise<void> {
  if (action === "detached") {
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

export async function handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
  const organizationId = stripeSubscription.metadata?.organizationId;
  if (!organizationId) return;

  const hobbyPlan = await db.query.plans.findFirst({ where: eq(plans.slug, "hobby") });
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
