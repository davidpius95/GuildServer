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
import { verifyFlutterwaveSignature } from "../services/billing/webhook-signature";
import { settleChargeFromProvider } from "../services/billing/flutterwave-v4";
import { logger } from "../utils/logger";

export const flutterwaveV4WebhookRouter = Router();

flutterwaveV4WebhookRouter.post("/", async (req: Request, res: Response) => {
  if (!verifyFlutterwaveSignature(req)) {
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

  try {
    if (!chargeId && !reference) {
      logger.warn("Flutterwave webhook carried no charge id or reference", { type: event.type });
      return res.status(200).json({ received: true });
    }
    if ((event.type || event.event) && (event.type || event.event) !== "charge.completed") return res.status(200).json({ received: true });

    const outcome = await settleChargeFromProvider({ chargeId, reference });
    logger.info("Flutterwave webhook settlement result", { chargeId, reference, outcome });
    return res.status(200).json({ received: true });
  } catch (err: any) {
    // Failure remains retryable at the provider.
    logger.error("Failed processing Flutterwave webhook", {
      chargeId,
      reference,
      error: String(err?.message ?? err),
    });
    return res.status(503).json({ error: "Payment verification unavailable; retry delivery" });
  }
});
