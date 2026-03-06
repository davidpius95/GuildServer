import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { logger } from "../utils/logger";
import {
  stripe,
  isStripeConfigured,
  syncSubscriptionFromStripe,
  syncInvoiceFromStripe,
  syncPaymentMethodFromStripe,
  handleSubscriptionDeleted,
} from "../services/stripe";
import { notify } from "../services/notification";
import { resetSpendNotifications } from "../services/spend-manager";
import { db, subscriptions, members } from "@guildserver/database";
import { eq, and } from "drizzle-orm";

export const stripeWebhookRouter = Router();

/**
 * Stripe Webhook handler.
 * IMPORTANT: This route must receive the raw body (not parsed as JSON).
 * The raw body parser is configured in index.ts before json() middleware.
 */
stripeWebhookRouter.post("/", async (req: Request, res: Response) => {
  if (!isStripeConfigured() || !stripe) {
    logger.warn("Stripe webhook received but Stripe is not configured");
    return res.status(200).json({ received: true, warning: "Stripe not configured" });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    if (webhookSecret) {
      // Verify webhook signature
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        logger.warn("Stripe webhook: missing signature header");
        return res.status(400).json({ error: "Missing stripe-signature header" });
      }

      event = stripe.webhooks.constructEvent(
        req.body, // raw body
        signature,
        webhookSecret
      );
    } else {
      // No webhook secret configured — parse body directly (dev mode only)
      logger.warn("Stripe webhook: no STRIPE_WEBHOOK_SECRET set, skipping signature verification");
      event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    }
  } catch (err: any) {
    logger.error(`Stripe webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  logger.info(`Stripe webhook received: ${event.type}`, { eventId: event.id });

  try {
    switch (event.type) {
      // ---- Checkout ----
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        logger.info(`Checkout completed for session ${session.id}`, {
          customer: session.customer,
          subscription: session.subscription,
        });
        // Subscription will be synced via customer.subscription.created event
        break;
      }

      // ---- Subscription lifecycle ----
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscriptionFromStripe(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata?.organizationId;
        const trialEndDate = subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toLocaleDateString()
          : "soon";
        logger.info(`Trial ending soon for org ${orgId}`, { trialEnd: trialEndDate });

        // Send trial ending notification to org owner
        if (orgId) {
          const owner = await db.query.members.findFirst({
            where: and(eq(members.organizationId, orgId), eq(members.role, "owner")),
          });
          if (owner && owner.userId) {
            notify("trial_ending", owner.userId, orgId, {
              trialEndDate,
              url: `${process.env.APP_URL || "http://localhost:3000"}/dashboard/billing`,
            }).catch((err) => logger.warn("Trial notification error:", err.message));
          }
        }
        break;
      }

      // ---- Invoices ----
      case "invoice.created":
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await syncInvoiceFromStripe(invoice);

        if (event.type === "invoice.payment_failed") {
          const customerId = invoice.customer as string;
          logger.warn(`Payment failed for customer ${customerId}`, {
            invoiceId: invoice.id,
            amountDue: invoice.amount_due,
          });
          // Find the org by stripe customer ID and notify owner
          const sub = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.stripeCustomerId, customerId),
          });
          if (sub) {
            const owner = await db.query.members.findFirst({
              where: and(eq(members.organizationId, sub.organizationId), eq(members.role, "owner")),
            });
            if (owner && owner.userId) {
              notify("deployment_failed", owner.userId, sub.organizationId, {
                appName: "Payment",
                error: `Payment of $${((invoice.amount_due || 0) / 100).toFixed(2)} failed. Please update your payment method.`,
                url: `${process.env.APP_URL || "http://localhost:3000"}/dashboard/billing`,
              }).catch((err) => logger.warn("Payment failed notification error:", err.message));
            }
          }
        }

        // Reset spend notifications on new invoice period
        if (event.type === "invoice.created") {
          const customerId = invoice.customer as string;
          const sub = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.stripeCustomerId, customerId),
          });
          if (sub) {
            resetSpendNotifications(sub.organizationId).catch(
              (err) => logger.warn("Reset spend notifications error:", err.message)
            );
          }
        }
        break;
      }

      // ---- Payment methods ----
      case "payment_method.attached": {
        const pm = event.data.object as Stripe.PaymentMethod;
        await syncPaymentMethodFromStripe(pm, "attached");
        break;
      }

      case "payment_method.detached": {
        const pm = event.data.object as Stripe.PaymentMethod;
        await syncPaymentMethodFromStripe(pm, "detached");
        break;
      }

      default:
        logger.debug(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (error: any) {
    logger.error(`Error processing Stripe webhook ${event.type}: ${error.message}`, {
      eventId: event.id,
      stack: error.stack,
    });
    // Return 200 anyway to prevent Stripe from retrying
    // (we log the error for debugging)
  }

  // Always return 200 to acknowledge receipt
  res.status(200).json({ received: true });
});
