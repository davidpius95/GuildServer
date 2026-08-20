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
import { settleChargeFromProvider } from "../services/billing/flutterwave-v4";
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

    const outcome = await settleChargeFromProvider({ chargeId, reference });
    logger.info("Flutterwave webhook settlement result", { chargeId, reference, outcome });
  } catch (err: any) {
    // Already acked; log loudly so reconciliation can pick it up.
    logger.error("Failed processing Flutterwave webhook", {
      chargeId,
      reference,
      error: String(err?.message ?? err),
    });
  }
});
