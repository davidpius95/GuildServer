import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import {
  isFlutterwaveConfigured,
  verifyFlutterwaveWebhookSignature,
  reconcileFlutterwaveTransaction,
} from "../services/billing";
import { db, paymentTransactions, subscriptions, plans, organizations, members } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { notify } from "../services/notification";
import { addInstanceProvisionJob } from "../queues/instances";

export const flutterwaveWebhookRouter = Router();

/**
 * Flutterwave Webhook handler.
 * Flutterwave signs webhooks with a static secret hash (Settings → Webhooks → Secret Hash),
 * sent back verbatim in the `verif-hash` header — not an HMAC, just an equality check.
 */
flutterwaveWebhookRouter.post("/", async (req: Request, res: Response) => {
  if (!isFlutterwaveConfigured()) {
    logger.warn("Flutterwave webhook received but Flutterwave is not configured");
    return res.status(200).json({ received: true, warning: "Flutterwave not configured" });
  }

  const signature = req.headers["verif-hash"] as string | undefined;
  if (!verifyFlutterwaveWebhookSignature(signature)) {
    logger.warn("Flutterwave webhook: signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.body;
  logger.info(`Flutterwave webhook received: ${event.event || "unknown"}`, { txRef: event.data?.tx_ref });

  try {
    if (event.event === "charge.completed" && event.data) {
      await reconcileFlutterwaveTransaction(event.data);

      const txn = await db.query.paymentTransactions.findFirst({
        where: eq(paymentTransactions.flutterwaveTxRef, event.data.tx_ref),
      });

      if (txn?.status === "succeeded") {
        await handleSucceededTransaction(txn);
      } else if (txn) {
        const owner = await db.query.members.findFirst({
          where: and(eq(members.organizationId, txn.organizationId), eq(members.role, "owner")),
        });
        if (owner?.userId) {
          notify("deployment_failed", owner.userId, txn.organizationId, {
            appName: "Payment",
            error: `Payment via Flutterwave failed or could not be verified.`,
            url: `${process.env.APP_URL || "http://localhost:3000"}/dashboard/billing`,
          }).catch((err) => logger.warn("Flutterwave failure notification error:", err.message));
        }
      }
    } else {
      logger.debug(`Unhandled Flutterwave event type: ${event.event}`);
    }
  } catch (error: any) {
    logger.error(`Error processing Flutterwave webhook: ${error.message}`, { stack: error.stack });
    // Return 200 anyway to prevent Flutterwave from retrying indefinitely; error is logged for follow-up.
  }

  res.status(200).json({ received: true });
});

/** Route a succeeded one-off payment to its effect: activate plan, queue instance, credit wallet, mark invoice paid. */
async function handleSucceededTransaction(txn: typeof paymentTransactions.$inferSelect): Promise<void> {
  const meta = (txn.metadata as Record<string, any>) || {};

  switch (txn.purpose) {
    case "subscription": {
      if (!meta.planSlug) break;
      const plan = await db.query.plans.findFirst({ where: eq(plans.slug, meta.planSlug) });
      if (!plan) break;

      const existingSub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, txn.organizationId),
      });

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      if (existingSub) {
        await db
          .update(subscriptions)
          .set({ planId: plan.id, status: "active", currentPeriodStart: now, currentPeriodEnd: periodEnd, updatedAt: now })
          .where(eq(subscriptions.id, existingSub.id));
      } else {
        await db.insert(subscriptions).values({
          organizationId: txn.organizationId,
          planId: plan.id,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        });
      }
      logger.info(`Activated plan ${meta.planSlug} for org ${txn.organizationId} via Flutterwave`);
      break;
    }

    case "instance": {
      if (meta.instanceId) {
        await addInstanceProvisionJob(meta.instanceId);
        logger.info(`Queued provisioning for paid instance ${meta.instanceId} (Flutterwave)`);
      }
      break;
    }

    case "invoice_payment": {
      if (meta.invoiceId) {
        const { invoices } = await import("@guildserver/database");
        await db
          .update(invoices)
          .set({ status: "paid", amountPaidCents: txn.amountCents, paidAt: new Date() })
          .where(eq(invoices.id, meta.invoiceId));
      }
      break;
    }

    case "wallet_topup":
      // Handled by spend-manager crediting logic — see routers/billing.ts confirmPayment flow.
      break;
  }
}
