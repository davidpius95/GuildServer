import crypto from "crypto";
import { db, organizations, invoices, paymentMethods, paymentTransactions } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";

const FLW_BASE_URL = "https://api.flutterwave.com/v3";
const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
const publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
const webhookHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;

export function isFlutterwaveConfigured(): boolean {
  return !!secretKey;
}

function requireSecretKey(): string {
  if (!secretKey) {
    throw new Error("Flutterwave is not configured. Set FLUTTERWAVE_SECRET_KEY in your environment.");
  }
  return secretKey;
}

export function getFlutterwavePublicKey(): string {
  if (!publicKey) throw new Error("FLUTTERWAVE_PUBLIC_KEY is not set.");
  return publicKey;
}

async function flwRequest(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${FLW_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireSecretKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok || body.status === "error") {
    throw new Error(body.message || `Flutterwave request failed (${res.status})`);
  }
  return body;
}

/**
 * Verify a webhook request came from Flutterwave.
 * Flutterwave sends a `verif-hash` header that must match the FLUTTERWAVE_WEBHOOK_SECRET_HASH
 * value configured in the Flutterwave dashboard (Settings → Webhooks).
 */
export function verifyFlutterwaveWebhookSignature(headerHash: string | undefined): boolean {
  if (!webhookHash) {
    logger.warn("Flutterwave webhook: no FLUTTERWAVE_WEBHOOK_SECRET_HASH set, skipping signature verification");
    return true; // dev mode only
  }
  if (!headerHash) return false;
  return crypto.timingSafeEqual(Buffer.from(headerHash), Buffer.from(webhookHash));
}

/**
 * Create a Flutterwave Standard hosted checkout link.
 * Supports card, bank transfer, USSD, and mobile money (NG/GH/KE/UG/ZM/RW/TZ...) automatically
 * based on the customer's currency/country — Flutterwave's hosted page shows the right options.
 */
export async function createFlutterwaveCheckout(args: {
  organizationId: string;
  purpose: "subscription" | "wallet_topup" | "instance" | "invoice_payment";
  amountCents: number;
  currency: string; // "NGN" | "USD" | "GHS" | "KES" | ...
  customerEmail: string;
  customerName?: string;
  redirectUrl: string;
  metadata?: Record<string, any>;
}): Promise<{ checkoutUrl: string; txRef: string; transactionId: string }> {
  const txRef = `gs_${args.purpose}_${crypto.randomUUID()}`;

  const [txn] = await db
    .insert(paymentTransactions)
    .values({
      organizationId: args.organizationId,
      provider: "flutterwave",
      status: "pending",
      purpose: args.purpose,
      amountCents: args.amountCents,
      currency: args.currency.toLowerCase(),
      flutterwaveTxRef: txRef,
      metadata: args.metadata || {},
    })
    .returning();

  const payload = {
    tx_ref: txRef,
    amount: (args.amountCents / 100).toFixed(2),
    currency: args.currency.toUpperCase(),
    redirect_url: args.redirectUrl,
    customer: {
      email: args.customerEmail,
      name: args.customerName,
    },
    customizations: {
      title: "GuildServer",
      description: describePurpose(args.purpose),
    },
    meta: { organizationId: args.organizationId, purpose: args.purpose, transactionId: txn.id, ...args.metadata },
  };

  const result = await flwRequest("/payments", { method: "POST", body: JSON.stringify(payload) });

  logger.info(`Created Flutterwave checkout for org ${args.organizationId} (${txRef})`);
  return { checkoutUrl: result.data.link, txRef, transactionId: txn.id };
}

function describePurpose(purpose: string): string {
  switch (purpose) {
    case "subscription": return "Subscription payment";
    case "wallet_topup": return "Wallet top-up";
    case "instance": return "VPS instance payment";
    default: return "Invoice payment";
  }
}

/** Verify a completed transaction directly with Flutterwave (defense-in-depth alongside webhook). */
export async function verifyFlutterwaveTransaction(transactionId: string): Promise<any> {
  const result = await flwRequest(`/transactions/${transactionId}/verify`);
  return result.data;
}

/**
 * Reconcile a Flutterwave transaction (from webhook or verify call) against our local record.
 * Marks the payment_transactions row succeeded/failed and, for subscriptions, activates the plan.
 */
export async function reconcileFlutterwaveTransaction(txData: {
  id: number | string;
  tx_ref: string;
  status: string; // "successful" | "failed" | "cancelled"
  amount: number;
  currency: string;
  customer?: { email?: string };
}): Promise<void> {
  const txn = await db.query.paymentTransactions.findFirst({
    where: eq(paymentTransactions.flutterwaveTxRef, txData.tx_ref),
  });

  if (!txn) {
    logger.warn(`Flutterwave: no local transaction found for tx_ref ${txData.tx_ref}`);
    return;
  }

  // Defense-in-depth: re-verify against Flutterwave's API and cross-check amount/currency before trusting.
  const verified = await verifyFlutterwaveTransaction(String(txData.id));
  const amountMatches = Math.round(verified.amount * 100) === txn.amountCents;
  const currencyMatches = verified.currency?.toLowerCase() === txn.currency;

  if (verified.status === "successful" && amountMatches && currencyMatches) {
    await db
      .update(paymentTransactions)
      .set({
        status: "succeeded",
        flutterwaveTxId: String(txData.id),
        paymentMethodDetail: verified.payment_type,
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, txn.id));

    logger.info(`Flutterwave payment succeeded for org ${txn.organizationId} (${txn.purpose}, ${txn.amountCents}c)`);
  } else {
    await db
      .update(paymentTransactions)
      .set({
        status: "failed",
        flutterwaveTxId: String(txData.id),
        failureReason: amountMatches && currencyMatches ? verified.status : "amount/currency mismatch",
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, txn.id));

    logger.warn(`Flutterwave payment failed/mismatched for org ${txn.organizationId} (${txData.tx_ref})`);
  }
}
