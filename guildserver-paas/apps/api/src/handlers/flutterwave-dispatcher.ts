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
import { timingSafeEqual } from "node:crypto";
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

function verifySignature(header: string | undefined): boolean {
  const expected = process.env.FLW_V4_WEBHOOK_SECRET_HASH;
  if (!expected) {
    logger.error("FLW_V4_WEBHOOK_SECRET_HASH is not set; rejecting dispatcher webhook");
    return false;
  }
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function forward(
  target: Downstream,
  body: unknown,
  verifHash: string,
  attempt = 1,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Consumers run their own signature check — pass it through.
        "verif-hash": verifHash,
        "x-forwarded-by": "guildserver-flutterwave-dispatcher",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    logger.info("Dispatched Flutterwave event downstream", { target: target.name, attempt });
  } catch (err: any) {
    if (attempt < MAX_ATTEMPTS) {
      const delayMs = 500 * 2 ** (attempt - 1);
      setTimeout(() => {
        void forward(target, body, verifHash, attempt + 1);
      }, delayMs);
      logger.warn("Downstream dispatch failed; retrying", {
        target: target.name,
        attempt,
        retryInMs: delayMs,
        error: String(err?.message ?? err),
      });
      return;
    }
    // Give up loudly — the event is lost to this consumer and needs
    // reconciliation rather than silent failure.
    logger.error("Downstream dispatch failed permanently", {
      target: target.name,
      attempts: attempt,
      error: String(err?.message ?? err),
    });
  }
}

flutterwaveDispatcherRouter.post("/", async (req: Request, res: Response) => {
  const verifHash = req.header("verif-hash");

  if (!verifySignature(verifHash)) {
    logger.warn("Rejected dispatcher webhook with bad signature", { ip: req.ip });
    return res.status(401).json({ error: "invalid signature" });
  }

  // Ack before doing any work.
  res.status(200).json({ received: true });

  const event = req.body ?? {};
  const data = event.data ?? {};
  const reference: string | undefined = data.reference;
  const chargeId: string | undefined = data.id;

  try {
    if (ownsReference(reference)) {
      const outcome = await settleChargeFromProvider({ chargeId, reference });
      logger.info("Dispatcher handled own event", {
        reference,
        chargeId,
        outcome: outcome.result,
        detail: outcome.result === "ignored" ? outcome.reason : outcome.status,
      });
      return;
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
      for (const d of downstreams()) void forward(d, event, verifHash!);
      return;
    }

    for (const t of targets) void forward(t, event, verifHash!);
  } catch (err: any) {
    logger.error("Dispatcher failed handling event", {
      reference,
      chargeId,
      error: String(err?.message ?? err),
    });
  }
});
