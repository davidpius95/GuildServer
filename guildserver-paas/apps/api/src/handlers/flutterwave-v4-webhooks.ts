/**
 * Flutterwave v4 webhook receiver.
 *
 * Security model: Flutterwave signs each delivery with a shared secret hash in
 * the `verif-hash` header. We compare in constant time and reject anything that
 * does not match, because this endpoint is public and mutates payment state.
 *
 * Trust model: the webhook body tells us WHICH charge changed, never HOW MUCH
 * was paid. We always re-fetch the charge from the API before settling, so a
 * forged or replayed body cannot credit an account.
 */

import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { db, paymentTransactions } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { fetchCharge, mapChargeStatus, toMinorUnits } from "../services/billing/flutterwave-v4";
import { logger } from "../utils/logger";

export const flutterwaveV4WebhookRouter = Router();

function verifySignature(header: string | undefined): boolean {
  const expected = process.env.FLW_V4_WEBHOOK_SECRET_HASH;

  // Refuse rather than accept-all when unconfigured — an unset secret must not
  // silently turn this into an open payment-mutation endpoint.
  if (!expected) {
    logger.error("FLW_V4_WEBHOOK_SECRET_HASH is not set; rejecting webhook");
    return false;
  }
  if (!header) return false;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

flutterwaveV4WebhookRouter.post("/", async (req: Request, res: Response) => {
  if (!verifySignature(req.header("verif-hash"))) {
    logger.warn("Rejected Flutterwave webhook with bad signature", {
      ip: req.ip,
      hasHeader: Boolean(req.header("verif-hash")),
    });
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = req.body ?? {};
  const data = event.data ?? {};
  const chargeId: string | undefined = data.id;
  const reference: string | undefined = data.reference;

  // Ack fast. Flutterwave retries on non-2xx, and slow handlers cause duplicate
  // deliveries; the state change below is idempotent so early ack is safe.
  res.status(200).json({ received: true });

  try {
    if (!chargeId && !reference) {
      logger.warn("Flutterwave webhook carried no charge id or reference", { type: event.type });
      return;
    }

    const [tx] = reference
      ? await db
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.flutterwaveTxRef, reference))
          .limit(1)
      : await db
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.flutterwaveTxId, chargeId!))
          .limit(1);

    if (!tx) {
      logger.warn("Flutterwave webhook for unknown transaction", { chargeId, reference });
      return;
    }

    // Terminal states are final — a replayed "succeeded" must not resurrect a
    // refunded or canceled transaction.
    if (tx.status === "succeeded" || tx.status === "canceled") {
      logger.info("Ignoring webhook for already-settled transaction", {
        paymentTransactionId: tx.id,
        status: tx.status,
      });
      return;
    }

    if (!chargeId) {
      logger.warn("Webhook had a reference but no charge id; cannot verify", { reference });
      return;
    }

    // Authoritative read — never trust amounts from the webhook body.
    const charge = await fetchCharge(chargeId);
    const status = mapChargeStatus(charge?.status);

    // Guard against underpayment: only settle if the verified amount covers it.
    const paidMinor = toMinorUnits(Number(charge?.amount ?? 0), charge?.currency ?? tx.currency);
    if (status === "succeeded" && paidMinor < tx.amountCents) {
      logger.error("Flutterwave charge underpaid; not marking succeeded", {
        paymentTransactionId: tx.id,
        expectedCents: tx.amountCents,
        paidCents: paidMinor,
      });
      await db
        .update(paymentTransactions)
        .set({
          status: "failed",
          failureReason: `Underpaid: expected ${tx.amountCents}, received ${paidMinor}`,
          updatedAt: new Date(),
        })
        .where(eq(paymentTransactions.id, tx.id));
      return;
    }

    await db
      .update(paymentTransactions)
      .set({
        status,
        flutterwaveTxId: chargeId,
        paymentMethodDetail: charge?.payment_method_details?.type ?? tx.paymentMethodDetail,
        paidAt: status === "succeeded" ? new Date() : tx.paidAt,
        failureReason:
          status === "failed"
            ? String(charge?.processor_response?.type ?? "charge failed").slice(0, 1000)
            : null,
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, tx.id));

    logger.info("Flutterwave webhook settled transaction", {
      paymentTransactionId: tx.id,
      chargeId,
      status,
    });
  } catch (err: any) {
    // Already acked; log loudly so reconciliation can pick it up.
    logger.error("Failed processing Flutterwave webhook", {
      chargeId,
      reference,
      error: String(err?.message ?? err),
    });
  }
});
