/**
 * Flutterwave v4 payment operations.
 *
 * Covers the checkout surfaces Flutterwave exposes: card, bank transfer,
 * mobile money, USSD, and static/dynamic virtual accounts.
 *
 * Two things bite here and are handled centrally:
 *
 *  1. UNITS. v4 speaks major units (300.0 == NGN 300). Our `payment_transactions`
 *     table stores `amount_cents` in minor units, like Stripe. Every boundary
 *     crossing goes through toMajorUnits/toMinorUnits — never inline the maths.
 *
 *  2. IDEMPOTENCY. We generate the `reference` ourselves and persist it before
 *     calling Flutterwave, so a retry after a timeout reuses the same reference
 *     instead of creating a second charge.
 */

import { randomUUID } from "node:crypto";
import { db, paymentTransactions, organizations } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { flwV4Request, isFlutterwaveV4Configured } from "./flutterwave-v4-client";
import { logger } from "../../utils/logger";

export type FlutterwavePaymentMethod =
  | "card"
  | "bank_transfer"
  | "mobile_money"
  | "ussd"
  | "virtual_account";

/**
 * Currencies with sub-units that are NOT 1/100. Flutterwave settles these in
 * whole units, so treating them as cents would inflate the charge 100x.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "XOF", "XAF", "RWF", "UGX"]);

export function toMajorUnits(amountCents: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) return amountCents;
  return Number((amountCents / 100).toFixed(2));
}

export function toMinorUnits(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) return Math.round(amount);
  return Math.round(amount * 100);
}

/** Flutterwave charge status -> our payment_transaction_status enum. */
export function mapChargeStatus(
  flwStatus: string | undefined,
): "pending" | "processing" | "succeeded" | "failed" | "canceled" | "expired" {
  switch ((flwStatus ?? "").toLowerCase()) {
    case "succeeded":
    case "successful":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
    case "canceled":
      return "canceled";
    case "expired":
      return "expired";
    case "pending":
      return "pending";
    // "processing", "requires_action", anything mid-flight.
    default:
      return "processing";
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

interface FlwCustomer {
  id: string;
  email?: string;
  name?: { first?: string; last?: string };
}

/**
 * Find-or-create the Flutterwave customer for an organization.
 *
 * The customer id is cached on organizations.metadata so we do not create a
 * duplicate customer per charge — Flutterwave has no upsert-by-email.
 */
export async function ensureFlutterwaveCustomer(organizationId: string): Promise<string> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org) throw new Error(`Organization ${organizationId} not found`);

  const meta = (org.metadata ?? {}) as Record<string, unknown>;
  const existing = meta.flutterwaveCustomerId;
  if (typeof existing === "string" && existing.startsWith("cus_")) {
    return existing;
  }

  const created = await flwV4Request<{ data: FlwCustomer }>("/customers", {
    method: "POST",
    idempotencyKey: `cus-${organizationId}`,
    body: {
      email: (meta.billingEmail as string) || `billing+${organizationId}@guild-technologies.com`,
      name: { first: org.name?.slice(0, 100) ?? "GuildServer", last: "Org" },
      meta: { organization_id: organizationId },
    },
  });

  const customerId = created?.data?.id;
  if (!customerId) throw new Error("Flutterwave did not return a customer id");

  await db
    .update(organizations)
    .set({ metadata: { ...meta, flutterwaveCustomerId: customerId } })
    .where(eq(organizations.id, organizationId));

  logger.info("Created Flutterwave customer", { organizationId, customerId });
  return customerId;
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

export interface CreateChargeArgs {
  organizationId: string;
  amountCents: number;
  currency: string;
  /** What this pays for: "subscription" | "instance" | "topup". */
  purpose: string;
  paymentMethod: FlutterwavePaymentMethod;
  /** Where to send the payer after a redirect-based flow (card 3DS, USSD). */
  redirectUrl?: string;
  /** Mobile money needs the payer's network and number. */
  mobileMoney?: { network: string; phoneNumber: string; countryCode?: string };
  invoiceId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  paymentTransactionId: string;
  reference: string;
  chargeId: string | null;
  status: string;
  /** Present when the payer must be redirected or shown bank/USSD details. */
  nextAction: unknown;
}

export async function createFlutterwaveCharge(args: CreateChargeArgs): Promise<ChargeResult> {
  if (!isFlutterwaveV4Configured()) {
    throw new Error("Flutterwave is not configured");
  }
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }

  const currency = args.currency.toUpperCase();
  const reference = `GS-${args.purpose.toUpperCase().slice(0, 8)}-${randomUUID().slice(0, 12)}`;

  // Persist BEFORE calling Flutterwave. If the call times out we still have a
  // row carrying the reference, so reconciliation can resolve the real outcome
  // instead of silently losing a payment the payer may already have made.
  const [tx] = await db
    .insert(paymentTransactions)
    .values({
      organizationId: args.organizationId,
      invoiceId: args.invoiceId ?? null,
      provider: "flutterwave",
      status: "pending",
      purpose: args.purpose,
      amountCents: args.amountCents,
      currency: currency.toLowerCase(),
      flutterwaveTxRef: reference,
      paymentMethodDetail: args.paymentMethod,
      metadata: (args.metadata ?? {}) as any,
    })
    .returning();

  try {
    const customerId = await ensureFlutterwaveCustomer(args.organizationId);

    const paymentMethodPayload: Record<string, unknown> = { type: args.paymentMethod };
    if (args.paymentMethod === "mobile_money") {
      if (!args.mobileMoney) throw new Error("mobile_money requires network and phoneNumber");
      paymentMethodPayload.mobile_money = {
        network: args.mobileMoney.network,
        phone_number: args.mobileMoney.phoneNumber,
        country_code: args.mobileMoney.countryCode ?? "NG",
      };
    }

    const charge = await flwV4Request<{ data: any }>("/charges", {
      method: "POST",
      // Same key on retry -> Flutterwave returns the original charge.
      idempotencyKey: reference,
      body: {
        currency,
        amount: toMajorUnits(args.amountCents, currency),
        customer_id: customerId,
        reference,
        payment_method: paymentMethodPayload,
        redirect_url: args.redirectUrl,
        meta: {
          organization_id: args.organizationId,
          payment_transaction_id: tx.id,
          purpose: args.purpose,
          ...(args.metadata ?? {}),
        },
      },
    });

    const data = charge?.data ?? {};
    const status = mapChargeStatus(data.status);

    await db
      .update(paymentTransactions)
      .set({
        flutterwaveTxId: data.id ?? null,
        status,
        paymentMethodDetail: data.payment_method_details?.type ?? args.paymentMethod,
        paidAt: status === "succeeded" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, tx.id));

    return {
      paymentTransactionId: tx.id,
      reference,
      chargeId: data.id ?? null,
      status,
      nextAction: data.next_action ?? data.payment_method_details ?? null,
    };
  } catch (err: any) {
    // Mark failed but keep the row: the reference is our only handle on a
    // charge that may still have succeeded on Flutterwave's side.
    await db
      .update(paymentTransactions)
      .set({
        status: "failed",
        failureReason: String(err?.message ?? err).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, tx.id));

    logger.error("Flutterwave charge failed", {
      organizationId: args.organizationId,
      reference,
      error: String(err?.message ?? err),
    });
    throw err;
  }
}

/** Authoritative status straight from Flutterwave, for reconciliation. */
export async function fetchCharge(chargeId: string): Promise<any> {
  const res = await flwV4Request<{ data: any }>(`/charges/${chargeId}`);
  return res?.data;
}

/** Reference prefix identifying charges this platform owns. */
export const GUILDSERVER_REFERENCE_PREFIX = "GS-";

export function ownsReference(reference: string | undefined | null): boolean {
  return typeof reference === "string" && reference.startsWith(GUILDSERVER_REFERENCE_PREFIX);
}

export type SettleOutcome =
  | { result: "settled"; paymentTransactionId: string; status: string }
  | { result: "ignored"; reason: string };

/**
 * Bring a payment_transaction in line with Flutterwave's authoritative state.
 *
 * Shared by the direct webhook route and the multi-app dispatcher, so both
 * paths get identical replay, underpayment and verification behaviour. Safe to
 * call repeatedly — webhook deliveries repeat by design.
 */
export async function settleChargeFromProvider(args: {
  chargeId?: string;
  reference?: string;
}): Promise<SettleOutcome> {
  const { chargeId, reference } = args;
  if (!chargeId && !reference) return { result: "ignored", reason: "no charge id or reference" };

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

  if (!tx) return { result: "ignored", reason: "unknown transaction" };

  // Terminal states are final; a replayed "succeeded" must not resurrect a
  // canceled transaction.
  if (tx.status === "succeeded" || tx.status === "canceled") {
    return { result: "ignored", reason: `already ${tx.status}` };
  }
  if (!chargeId) return { result: "ignored", reason: "no charge id to verify against" };

  // Never trust the webhook body for amounts — re-read from the API.
  const charge = await fetchCharge(chargeId);
  const status = mapChargeStatus(charge?.status);
  const paidMinor = toMinorUnits(Number(charge?.amount ?? 0), charge?.currency ?? tx.currency);

  if (status === "succeeded" && paidMinor < tx.amountCents) {
    await db
      .update(paymentTransactions)
      .set({
        status: "failed",
        failureReason: `Underpaid: expected ${tx.amountCents}, received ${paidMinor}`,
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, tx.id));
    logger.error("Flutterwave charge underpaid", {
      paymentTransactionId: tx.id,
      expectedCents: tx.amountCents,
      paidCents: paidMinor,
    });
    return { result: "settled", paymentTransactionId: tx.id, status: "failed" };
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

  logger.info("Settled Flutterwave transaction", { paymentTransactionId: tx.id, chargeId, status });
  return { result: "settled", paymentTransactionId: tx.id, status };
}

// ---------------------------------------------------------------------------
// Virtual accounts
// ---------------------------------------------------------------------------

export interface VirtualAccountResult {
  id: string;
  accountNumber: string;
  bankName: string;
  reference: string;
  status: string;
  expiresAt: string | null;
  currency: string;
}

/**
 * Issue a bank account the org can transfer into. `static` accounts persist and
 * are the right choice for recurring top-ups; `dynamic` expire per payment.
 */
export async function createVirtualAccount(args: {
  organizationId: string;
  currency?: string;
  accountType?: "static" | "dynamic";
  amountCents?: number;
  narration?: string;
}): Promise<VirtualAccountResult> {
  if (!isFlutterwaveV4Configured()) throw new Error("Flutterwave is not configured");

  const currency = (args.currency ?? "NGN").toUpperCase();
  const customerId = await ensureFlutterwaveCustomer(args.organizationId);
  const reference = `GS-VA-${randomUUID().slice(0, 12)}`;

  const body: Record<string, unknown> = {
    currency,
    customer_id: customerId,
    reference,
    account_type: args.accountType ?? "static",
    narration: args.narration ?? "GuildServer",
    meta: { organization_id: args.organizationId },
  };

  // Which bank issues the account (035 = Wema by default).
  if (process.env.FLW_VA_BANK_CODE) body.account_bank_code = process.env.FLW_VA_BANK_CODE;
  if (args.amountCents) body.amount = toMajorUnits(args.amountCents, currency);

  const res = await flwV4Request<{ data: any }>("/virtual-accounts", {
    method: "POST",
    idempotencyKey: reference,
    body,
  });

  const d = res?.data ?? {};
  logger.info("Issued Flutterwave virtual account", {
    organizationId: args.organizationId,
    virtualAccountId: d.id,
  });

  return {
    id: d.id,
    accountNumber: d.account_number,
    bankName: d.account_bank_name,
    reference: d.reference ?? reference,
    status: d.status,
    expiresAt: d.account_expiration_datetime ?? null,
    currency: d.currency ?? currency,
  };
}

export async function listVirtualAccounts(organizationId: string): Promise<VirtualAccountResult[]> {
  const customerId = await ensureFlutterwaveCustomer(organizationId);
  const res = await flwV4Request<{ data: any[] }>(`/virtual-accounts?customer_id=${customerId}`);
  return (res?.data ?? []).map((d) => ({
    id: d.id,
    accountNumber: d.account_number,
    bankName: d.account_bank_name,
    reference: d.reference,
    status: d.status,
    expiresAt: d.account_expiration_datetime ?? null,
    currency: d.currency,
  }));
}

/** Banks available for a country — used to populate bank-transfer pickers. */
export async function listBanks(country = "NG"): Promise<Array<{ id: string; code: string; name: string }>> {
  const res = await flwV4Request<{ data: any[] }>(`/banks?country=${encodeURIComponent(country)}`);
  return (res?.data ?? []).map((b) => ({ id: b.id, code: b.code, name: b.name }));
}
