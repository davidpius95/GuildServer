/**
 * Flutterwave webhook dispatcher (fan-out).
 *
 * Flutterwave allows exactly ONE webhook URL per account — there is no
 * subscription API (verified: /webhooks, /webhook-subscriptions, /subscriptions
 * and /events all 404). Several applications on this host need those events, so
 * one endpoint receives every delivery and routes each event to whichever
 * application owns it.
 *
 * Ownership is decided by the charge `reference`, which each application
 * generates with its own prefix:
 *
 *     GS-*   -> this platform (GuildServer PaaS)
 *     other  -> forwarded downstream (GuildPay uses GPA-*)
 *
 * Design rules:
 *
 *  - The signature is verified HERE, once, before anything is routed. An
 *    unsigned request never reaches a consumer.
 *  - Flutterwave is acked immediately. Fan-out happens after the response, so a
 *    slow or down consumer cannot cause Flutterwave to time out and retry.
 *  - Downstream calls forward the original `verif-hash` header, because
 *    consumers verify the shared secret themselves and must keep doing so.
 *    The dispatcher is a router, not a trust boundary they have to take on faith.
 *  - Delivery is retried with backoff; consumers are expected to be idempotent
 *    because webhook deliveries repeat by design.
 */

import { Router, type Request, type Response } from "express";
import { verifyFlutterwaveSignature } from "../services/billing/webhook-signature";
import { ownsReference, settleChargeFromProvider } from "../services/billing/flutterwave-v4";
import { logger } from "../utils/logger";

export const flutterwaveDispatcherRouter = Router();

/** Applications that receive events this platform does not own. */
interface Downstream {
  name: string;
  url: string;
  /** Reference prefixes this app owns. Empty = receives anything unclaimed. */
  prefixes: string[];
}

function downstreams(): Downstream[] {
  // Internal Docker-network address; never routed through the public edge.
  const guildpay = process.env.GUILDPAY_WEBHOOK_URL ?? "http://guildpay-api:3001/webhooks/flutterwave-v4";
  return [{ name: "guildpay", url: guildpay, prefixes: ["GPA-"] }];
}

async function forward(target: Downstream, body: unknown): Promise<void> {
  const res = await fetch(target.url, { method: "POST", headers: { "Content-Type": "application/json", "verif-hash": process.env.FLW_V4_WEBHOOK_SECRET_HASH!, "x-forwarded-by": "guildserver-flutterwave-dispatcher" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Downstream returned ${res.status}`);
}

flutterwaveDispatcherRouter.post("/", async (req: Request, res: Response) => {
  const verifHash = req.header("verif-hash");

  if (!verifyFlutterwaveSignature(req)) {
    logger.warn("Rejected dispatcher webhook with bad signature", { ip: req.ip });
    return res.status(401).json({ error: "invalid signature" });
  }


  const event = req.body ?? {};
  const data = event.data ?? {};
  const reference: string | undefined = data.reference;
  const chargeId: string | undefined = data.id;

  try {
    if (ownsReference(reference)) {
      if ((event.type || event.event) !== "charge.completed") return res.status(200).json({ received: true });
      const outcome = await settleChargeFromProvider({ chargeId, reference });
      logger.info("Dispatcher handled own event", {
        reference,
        chargeId,
        outcome: outcome.result,
        detail: outcome.result === "ignored" ? outcome.reason : outcome.status,
      });
      return res.status(200).json({ received: true });
    }

    const targets = downstreams().filter(
      (d) => d.prefixes.length === 0 || d.prefixes.some((p) => reference?.startsWith(p)),
    );

    if (targets.length === 0) {
      // Unknown prefix: broadcast rather than drop. A misrouted event is
      // recoverable by an idempotent consumer; a dropped payment is not.
      logger.warn("Unrecognised reference prefix; broadcasting to all consumers", {
        reference,
        chargeId,
      });
      // A checkout event can omit reference. Resolve its verified ownership first.
      if (chargeId && (event.type || event.event) === "charge.completed") await settleChargeFromProvider({ chargeId });
      for (const d of downstreams()) await forward(d, event);
      return res.status(200).json({ received: true });
    }

    for (const t of targets) await forward(t, event);
    return res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error("Dispatcher failed handling event", {
      reference,
      chargeId,
      error: String(err?.message ?? err),
    });
    return res.status(503).json({ error: "Payment verification unavailable; retry delivery" });
  }
});
