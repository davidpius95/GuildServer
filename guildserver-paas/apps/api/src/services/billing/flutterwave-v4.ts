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

import crypto, { randomUUID, randomBytes, createCipheriv } from "node:crypto";
import { db, paymentTransactions, organizations, invoices, members, users } from "@guildserver/database";
import { eq, and, sql } from "drizzle-orm";
import { flwV4Request, isFlutterwaveV4Configured } from "./flutterwave-v4-client";
import { assertPositiveMinorAmount, normalizeCurrency, toMajorUnits, toMinorUnits } from "./money";
import { assertPaymentSelection } from "./catalog";
import { settlePaymentAttempt } from "./settlement";
import { logger } from "../../utils/logger";

export type FlutterwavePaymentMethod =
  | "card"
  | "bank_transfer"
  | "mobile_money"
  | "ussd"
  | "virtual_account";

export { toMajorUnits, toMinorUnits } from "./money";


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

  // Resolve best email: billingEmail on meta, or org owner's email
  let targetEmail = typeof meta.billingEmail === "string" ? meta.billingEmail.trim() : "";
  if (!targetEmail || targetEmail.includes("+")) {
    const [ownerRecord] = await db
      .select({ email: users.email })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.organizationId, organizationId), eq(members.role, "owner")))
      .limit(1);

    if (ownerRecord?.email && !ownerRecord.email.includes("+")) {
      targetEmail = ownerRecord.email.trim();
    }
  }

  if (!targetEmail) {
    targetEmail = `billing@guild-technologies.com`;
  }

  // If already cached with matching email, return it
  if (
    typeof existing === "string" &&
    existing.startsWith("cus_") &&
    meta.flutterwaveCustomerEmail === targetEmail
  ) {
    return existing;
  }

  // Check if customer already exists on Flutterwave by email
  try {
    const searchRes = await flwV4Request<{ data: FlwCustomer[] }>(
      `/customers?email=${encodeURIComponent(targetEmail)}`
    );
    const matched = searchRes.data?.find((c) => c.email?.toLowerCase() === targetEmail.toLowerCase());
    if (matched?.id) {
      await db
        .update(organizations)
        .set({
          metadata: {
            ...meta,
            flutterwaveCustomerId: matched.id,
            flutterwaveCustomerEmail: targetEmail,
          },
        })
        .where(eq(organizations.id, organizationId));
      return matched.id;
    }
  } catch {
    // Continue to creation if search fails
  }

  try {
    const created = await flwV4Request<{ data: FlwCustomer }>("/customers", {
      method: "POST",
      idempotencyKey: `cus-${organizationId}-${Buffer.from(targetEmail).toString("hex").slice(0, 10)}`,
      body: {
        email: targetEmail,
        name: { first: org.name?.slice(0, 100) ?? "GuildServer", last: "Org" },
        meta: { organization_id: organizationId },
      },
    });

    const customerId = created?.data?.id;
    if (!customerId) throw new Error("Flutterwave did not return a customer id");

    await db
      .update(organizations)
      .set({
        metadata: {
          ...meta,
          flutterwaveCustomerId: customerId,
          flutterwaveCustomerEmail: targetEmail,
        },
      })
      .where(eq(organizations.id, organizationId));

    logger.info("Created Flutterwave customer", { organizationId, customerId, email: targetEmail });
    return customerId;
  } catch (err: any) {
    // If conflict, re-fetch customer by email
    const searchRes = await flwV4Request<{ data: FlwCustomer[] }>(
      `/customers?email=${encodeURIComponent(targetEmail)}`
    );
    const matched = searchRes.data?.find((c) => c.email?.toLowerCase() === targetEmail.toLowerCase());
    if (matched?.id) {
      await db
        .update(organizations)
        .set({
          metadata: {
            ...meta,
            flutterwaveCustomerId: matched.id,
            flutterwaveCustomerEmail: targetEmail,
          },
        })
        .where(eq(organizations.id, organizationId));
      return matched.id;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
export interface CardPaymentDetails {
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

export function encryptCardPayload(
  card: CardPaymentDetails,
  encryptionKeyBase64: string,
): {
  encryptedCardNumber: string;
  encryptedExpiryMonth: string;
  encryptedExpiryYear: string;
  encryptedCvv: string;
  nonce: string;
} {
  const key = Buffer.from(encryptionKeyBase64, "base64");
  if (key.length !== 32) {
    throw new Error(`Flutterwave v4 encryption key must be 32 bytes (got ${key.length})`);
  }

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  const random = randomBytes(12);
  for (let i = 0; i < 12; i++) {
    nonce += chars[random[i] % chars.length];
  }
  const nonceBuf = Buffer.from(nonce, "utf8");

  function encryptField(val: string): string {
    const cipher = createCipheriv("aes-256-gcm", key, nonceBuf);
    const enc = Buffer.concat([cipher.update(val, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([enc, tag]).toString("base64");
  }

  const cleanNumber = card.cardNumber.replace(/\D/g, "");
  const cleanMonth = card.expiryMonth.replace(/\D/g, "").padStart(2, "0");
  const cleanYear = card.expiryYear.replace(/\D/g, "").slice(-2);
  const cleanCvv = card.cvv.replace(/\D/g, "");

  if (cleanNumber.length < 12 || cleanNumber.length > 19) {
    throw new Error("Invalid card number format");
  }
  if (!cleanMonth || Number(cleanMonth) < 1 || Number(cleanMonth) > 12) {
    throw new Error("Invalid card expiry month (01-12)");
  }
  if (!cleanYear || cleanYear.length !== 2) {
    throw new Error("Invalid card expiry year (2 digits)");
  }
  if (cleanCvv.length < 3 || cleanCvv.length > 4) {
    throw new Error("Invalid CVV (3-4 digits)");
  }

  return {
    encryptedCardNumber: encryptField(cleanNumber),
    encryptedExpiryMonth: encryptField(cleanMonth),
    encryptedExpiryYear: encryptField(cleanYear),
    encryptedCvv: encryptField(cleanCvv),
    nonce,
  };
}

export interface CreateChargeArgs {
  organizationId: string;
  amountCents: number;
  currency: string;
  /** What this pays for: "subscription" | "instance" | "topup". */
  purpose: string;
  paymentMethod: FlutterwavePaymentMethod;
  /** Where to send the payer after a redirect-based flow (card 3DS, USSD). */
  redirectUrl?: string;
  card?: CardPaymentDetails;
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

export async function createFlutterwaveCheckoutSession(args: CreateChargeArgs): Promise<ChargeResult> {
  if (!isFlutterwaveV4Configured()) {
    throw new Error("Flutterwave is not configured");
  }
  assertPositiveMinorAmount(args.amountCents);

  const currency = normalizeCurrency(args.currency).toUpperCase();
  assertPaymentSelection(currency, args.paymentMethod);
  if (!args.invoiceId) throw new Error("An invoice is required for checkout");
  const reserved = await db.transaction(async (connection) => {
    await connection.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"billing:" + args.organizationId}, 0))`);
    const invoice = await connection.query.invoices.findFirst({ where: and(eq(invoices.id, args.invoiceId!), eq(invoices.organizationId, args.organizationId)) });
    if (!invoice || invoice.status !== "open" || invoice.currency?.toLowerCase() !== currency.toLowerCase() || Number(invoice.amountDueCents) - Number(invoice.amountPaidCents) !== args.amountCents) throw new Error("Invoice balance changed. Refresh billing before paying.");
    const existing = await connection.query.paymentTransactions.findMany({ where: and(eq(paymentTransactions.invoiceId, args.invoiceId!), eq(paymentTransactions.provider, "flutterwave")), orderBy: (p, { desc }) => [desc(p.createdAt)] });
    const pending = existing.find(p => p.status === "pending" || p.status === "processing");
    if (pending) {
      const isStale = Date.now() - new Date(pending.createdAt!).getTime() > 30 * 60_000;
      if (isStale) {
        await connection
          .update(paymentTransactions)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(paymentTransactions.id, pending.id));
      } else {
        const action = (pending.metadata as any)?.nextAction;
        if (action?.type === "bank_transfer" && action.bank_transfer) {
          return { paymentTransactionId: pending.id, reference: pending.flutterwaveTxRef!, chargeId: pending.flutterwaveTxId, status: pending.status!, nextAction: action };
        }
        if (action?.redirect_url?.url) {
          return { paymentTransactionId: pending.id, reference: pending.flutterwaveTxRef!, chargeId: pending.flutterwaveTxId, status: pending.status!, nextAction: action };
        }
        await connection
          .update(paymentTransactions)
          .set({ status: "failed", failureReason: "Checkout session was not initialized", updatedAt: new Date() })
          .where(eq(paymentTransactions.id, pending.id));
      }
    }
    const reference = `GS-INV-${randomUUID().replace(/-/g, "").slice(0, 24)}`;

    const [tx] = await connection
      .insert(paymentTransactions)
      .values({
        organizationId: args.organizationId,
        invoiceId: args.invoiceId ?? null,
        provider: "flutterwave",
        status: "pending",
        purpose: args.purpose,
        amountCents: args.amountCents,
        currency: normalizeCurrency(currency),
        flutterwaveTxRef: reference,
        paymentMethodDetail: args.paymentMethod,
        metadata: (args.metadata ?? {}) as any,
      })
      .returning();
    return { tx, reference };
  });
  if (!("tx" in reserved)) return reserved;
  const { tx, reference } = reserved;
  if (!tx || !reference) throw new Error("Payment reservation failed");

  try {
    if (args.paymentMethod === "bank_transfer") {
      const va = await createVirtualAccount({
        organizationId: args.organizationId,
        currency,
        accountType: "dynamic",
        amountCents: args.amountCents,
        narration: (args.metadata?.invoice_number as string) || "GuildServer",
        reference,
      });

      const nextAction = {
        type: "bank_transfer",
        bank_transfer: {
          accountNumber: va.accountNumber,
          bankName: va.bankName,
          amount: toMajorUnits(args.amountCents, currency),
          currency,
          expiresAt: va.expiresAt,
          reference: va.reference,
          note: "Transfer the exact amount to the virtual account details above.",
        },
      };

      await db
        .update(paymentTransactions)
        .set({
          flutterwaveTxId: va.id ?? null,
          flutterwaveTxRef: va.reference,
          metadata: {
            ...(args.metadata ?? {}),
            nextAction,
          },
          status: "pending",
          updatedAt: new Date(),
        })
        .where(and(eq(paymentTransactions.id, tx.id), eq(paymentTransactions.status, "pending")));

      return {
        paymentTransactionId: tx.id,
        reference: va.reference,
        chargeId: va.id ?? null,
        status: "pending",
        nextAction,
      };
    }

    if (args.paymentMethod === "card") {
      if (!args.card) {
        throw new Error(
          "Please enter your card number, expiry date, and CVV to proceed with card payment, or choose Bank Transfer (instant virtual account)."
        );
      }

      const encryptionKey = process.env.FLW_V4_ENCRIPTION_KEY;
      if (!encryptionKey) {
        throw new Error(
          "Card processing is temporarily unavailable (encryption key not configured). Please choose Bank Transfer (instant virtual account)."
        );
      }

      const enc = encryptCardPayload(args.card, encryptionKey);

      // Create payment method with encrypted card payload
      const pmdRes = await flwV4Request<{ data: any }>("/payment-methods", {
        method: "POST",
        idempotencyKey: `pmd-${reference.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`,
        body: {
          type: "card",
          card: {
            encrypted_card_number: enc.encryptedCardNumber,
            encrypted_expiry_month: enc.encryptedExpiryMonth,
            encrypted_expiry_year: enc.encryptedExpiryYear,
            encrypted_cvv: enc.encryptedCvv,
            nonce: enc.nonce,
          },
        },
      });

      const paymentMethodId = pmdRes?.data?.id;
      if (!paymentMethodId) {
        throw new Error("Could not register card payment method with Flutterwave");
      }

      const customerId = await ensureFlutterwaveCustomer(args.organizationId);
      const redirectBase =
        args.redirectUrl ||
        `${process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:3000"}/dashboard/billing`;
      const redirectUrl = `${redirectBase}${redirectBase.includes("?") ? "&" : "?"}payment=${tx.id}`;

      const charge = await flwV4Request<{ data: any }>("/charges", {
        method: "POST",
        idempotencyKey: reference,
        body: {
          amount: toMajorUnits(args.amountCents, currency),
          currency,
          customer_id: customerId,
          payment_method_id: paymentMethodId,
          reference,
          redirect_url: redirectUrl,
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

      if (status === "succeeded") {
        await db
          .update(paymentTransactions)
          .set({
            flutterwaveTxId: data.id ?? null,
            status: "succeeded",
            paidAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentTransactions.id, tx.id));

        if (args.invoiceId) {
          await settlePaymentAttempt({
            provider: "flutterwave",
            providerReference: data.id ?? reference,
            paymentTransactionId: tx.id,
            verifiedStatus: "succeeded",
            verifiedAmountCents: args.amountCents,
            verifiedCurrency: currency,
            providerPaymentMethodDetail: "card",
            rawProviderPayload: data,
          });
        }

        return {
          paymentTransactionId: tx.id,
          reference,
          chargeId: data.id ?? null,
          status: "succeeded",
          nextAction: null,
        };
      }

      const redirectActionUrl = data.next_action?.redirect_url?.url || data.redirect_url;
      if (redirectActionUrl) {
        const nextAction = {
          type: "redirect_url",
          redirect_url: { url: redirectActionUrl },
        };

        await db
          .update(paymentTransactions)
          .set({
            flutterwaveTxId: data.id ?? null,
            metadata: { ...(args.metadata ?? {}), nextAction },
            status: "pending",
            updatedAt: new Date(),
          })
          .where(and(eq(paymentTransactions.id, tx.id), eq(paymentTransactions.status, "pending")));

        return {
          paymentTransactionId: tx.id,
          reference,
          chargeId: data.id ?? null,
          status: "pending",
          nextAction,
        };
      }

      if (status === "failed") {
        const reason =
          data.processor_response?.message ||
          data.processor_response?.type ||
          "Card payment was declined by your bank";
        throw new Error(
          `${reason}. Please verify your card details or choose Bank Transfer (instant virtual account) to complete payment.`
        );
      }

      return {
        paymentTransactionId: tx.id,
        reference,
        chargeId: data.id ?? null,
        status: "pending",
        nextAction: data.next_action ?? null,
      };
    }

    throw new Error(`Unsupported payment method: ${args.paymentMethod}`);
  } catch (err: any) {
    await db
      .update(paymentTransactions)
      .set({
        status: "failed",
        failureReason: String(err?.message ?? err).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(and(eq(paymentTransactions.id, tx.id), eq(paymentTransactions.status, "pending")));

    logger.error("Flutterwave checkout session failed", {
      organizationId: args.organizationId,
      reference,
      error: String(err?.message ?? err),
    });
    throw new Error(err?.message || "Checkout could not be started. Please try again.");
  }
}

export async function createFlutterwaveCharge(args: CreateChargeArgs): Promise<ChargeResult> {
  if (!isFlutterwaveV4Configured()) {
    throw new Error("Flutterwave is not configured");
  }
  assertPositiveMinorAmount(args.amountCents);

  const currency = normalizeCurrency(args.currency).toUpperCase();
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
      currency: normalizeCurrency(currency),
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
  let { chargeId, reference } = args;
  if (!chargeId && reference) {
    const matches = await flwV4Request<{ data: any[] }>(`/charges?reference=${encodeURIComponent(reference)}`);
    const charge = matches.data?.find(item => item.reference === reference);
    if (charge) chargeId = charge.id;
  }
  if (!chargeId) return { result: "ignored", reason: "no charge id to verify against" };
  const charge = await fetchCharge(chargeId);
  if (!charge?.id || charge.id !== chargeId || !ownsReference(charge.reference)) return { result: "ignored", reason: "not a GuildServer charge" };
  if (reference && charge.reference !== reference) throw new Error("Provider reference mismatch");
  reference = charge.reference;
  const [tx] = await db.select().from(paymentTransactions).where(and(eq(paymentTransactions.provider, "flutterwave"), eq(paymentTransactions.flutterwaveTxRef, reference!))).limit(1);
  if (!tx) return { result: "ignored", reason: "unknown transaction" };
  if (!charge.currency) throw new Error("Provider currency missing");
  const status = mapChargeStatus(charge.status);
  const paidMinor = status === "succeeded" ? toMinorUnits(Number(charge.amount), charge.currency) : 0;

  const settled = await settlePaymentAttempt({
    provider: "flutterwave",
    providerReference: chargeId,
    paymentTransactionId: tx.id,
    verifiedStatus: status,
    verifiedAmountCents: paidMinor,
    verifiedCurrency: charge?.currency ?? tx.currency,
    providerPaymentMethodDetail: charge?.payment_method_details?.type ?? tx.paymentMethodDetail,
    failureReason:
      status === "failed"
        ? String(charge?.processor_response?.type ?? "charge failed").slice(0, 1000)
        : null,
    rawProviderPayload: charge,
  });

  logger.info("Settled Flutterwave transaction", {
    paymentTransactionId: tx.id,
    chargeId,
    status: settled.status,
    result: settled.result,
  });

  return settled.result === "settled"
    ? { result: "settled", paymentTransactionId: tx.id, status: settled.status ?? status }
    : { result: "ignored", reason: settled.reason ?? "ignored" };
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
  reference?: string;
}): Promise<VirtualAccountResult> {
  if (!isFlutterwaveV4Configured()) throw new Error("Flutterwave is not configured");

  const currency = (args.currency ?? "NGN").toUpperCase();
  const customerId = await ensureFlutterwaveCustomer(args.organizationId);
  const reference = args.reference ?? `GS-VA-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const body: Record<string, unknown> = {
    currency,
    customer_id: customerId,
    reference,
    account_type: args.accountType ?? "static",
    narration: args.narration ?? "GuildServer",
    meta: { organization_id: args.organizationId },
  };

  if (args.accountType === "dynamic") {
    body.expiry = 1800; // 30 minutes in seconds
  } else if (process.env.FLW_VA_BANK_CODE) {
    body.account_bank_code = process.env.FLW_VA_BANK_CODE;
  }

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
