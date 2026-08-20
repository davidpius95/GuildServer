import {
  db,
  invoices,
  plans,
  paymentTransactions,
  receipts,
  subscriptions,
  type Database,
} from "@guildserver/database";
import { eq } from "drizzle-orm";
import { appendLedgerEntry } from "./ledger";
import { normalizeCurrency } from "./money";

type DbLike = Database | any;

export type VerifiedPaymentStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "expired";

export interface SettlePaymentAttemptArgs {
  provider: "stripe" | "flutterwave" | "crypto";
  providerReference: string;
  paymentTransactionId?: string;
  verifiedStatus: VerifiedPaymentStatus;
  verifiedAmountCents: number;
  verifiedCurrency: string;
  providerPaymentMethodDetail?: string | null;
  failureReason?: string | null;
  rawProviderPayload?: unknown;
  database?: DbLike;
}

export interface SettlementResult {
  result: "settled" | "ignored";
  paymentTransactionId?: string;
  invoiceId?: string | null;
  receiptId?: string | null;
  status?: VerifiedPaymentStatus;
  reason?: string;
}

function generateReceiptNumber(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `R-${stamp}-${random}`;
}

async function findPaymentTransaction(args: SettlePaymentAttemptArgs, database: DbLike) {
  if (args.paymentTransactionId) {
    return database.query.paymentTransactions.findFirst({
      where: eq(paymentTransactions.id, args.paymentTransactionId),
    });
  }

  if (args.provider === "flutterwave") {
    const byReference = await database.query.paymentTransactions.findFirst({
      where: eq(paymentTransactions.flutterwaveTxRef, args.providerReference),
    });
    if (byReference) return byReference;

    return database.query.paymentTransactions.findFirst({
      where: eq(paymentTransactions.flutterwaveTxId, args.providerReference),
    });
  }

  return null;
}

function failureForStatus(status: VerifiedPaymentStatus, fallback?: string | null): string | null {
  if (status === "failed") return fallback ?? "Payment failed";
  if (status === "canceled") return fallback ?? "Payment canceled";
  if (status === "expired") return fallback ?? "Payment expired";
  return null;
}

export async function settlePaymentAttempt(args: SettlePaymentAttemptArgs): Promise<SettlementResult> {
  const database = args.database ?? db;
  const verifiedCurrency = normalizeCurrency(args.verifiedCurrency);

  return database.transaction(async (tx: DbLike) => {
    const paymentTx = await findPaymentTransaction(args, tx);
    if (!paymentTx) {
      return { result: "ignored", reason: "unknown payment transaction" };
    }

    if (paymentTx.status === "succeeded") {
      const existingReceipt = paymentTx.invoiceId
        ? await tx.query.receipts.findFirst({
            where: eq(receipts.paymentTransactionId, paymentTx.id),
          })
        : null;
      return {
        result: "ignored",
        reason: "already succeeded",
        paymentTransactionId: paymentTx.id,
        invoiceId: paymentTx.invoiceId,
        receiptId: existingReceipt?.id ?? null,
        status: "succeeded",
      };
    }

    const expectedCurrency = normalizeCurrency(paymentTx.currency);
    if (verifiedCurrency !== expectedCurrency) {
      await tx
        .update(paymentTransactions)
        .set({
          status: "failed",
          failureReason: `Currency mismatch: expected ${expectedCurrency}, received ${verifiedCurrency}`,
          updatedAt: new Date(),
        })
        .where(eq(paymentTransactions.id, paymentTx.id));
      return {
        result: "settled",
        paymentTransactionId: paymentTx.id,
        invoiceId: paymentTx.invoiceId,
        status: "failed",
        reason: "currency mismatch",
      };
    }

    if (args.verifiedStatus === "succeeded" && args.verifiedAmountCents < paymentTx.amountCents) {
      await tx
        .update(paymentTransactions)
        .set({
          status: "failed",
          failureReason: `Underpaid: expected ${paymentTx.amountCents}, received ${args.verifiedAmountCents}`,
          updatedAt: new Date(),
        })
        .where(eq(paymentTransactions.id, paymentTx.id));
      return {
        result: "settled",
        paymentTransactionId: paymentTx.id,
        invoiceId: paymentTx.invoiceId,
        status: "failed",
        reason: "underpaid",
      };
    }

    if (args.verifiedStatus !== "succeeded") {
      await tx
        .update(paymentTransactions)
        .set({
          status: args.verifiedStatus,
          failureReason: failureForStatus(args.verifiedStatus, args.failureReason),
          updatedAt: new Date(),
        })
        .where(eq(paymentTransactions.id, paymentTx.id));
      return {
        result: "settled",
        paymentTransactionId: paymentTx.id,
        invoiceId: paymentTx.invoiceId,
        status: args.verifiedStatus,
      };
    }

    const paymentUpdate: Record<string, unknown> = {
      status: "succeeded",
      paidAt: new Date(),
      failureReason: null,
      updatedAt: new Date(),
    };

    if (args.provider === "flutterwave") {
      paymentUpdate.flutterwaveTxId = args.providerReference;
    }
    if (args.providerPaymentMethodDetail) {
      paymentUpdate.paymentMethodDetail = args.providerPaymentMethodDetail;
    }

    await tx.update(paymentTransactions).set(paymentUpdate).where(eq(paymentTransactions.id, paymentTx.id));

    let receiptId: string | null = null;
    if (paymentTx.purpose === "subscription") {
      const metadata = (paymentTx.metadata ?? {}) as Record<string, unknown>;
      const planSlug =
        metadata.planSlug === "starter" || metadata.planSlug === "pro" ? metadata.planSlug : null;

      if (planSlug) {
        const plan = await tx.query.plans.findFirst({
          where: eq(plans.slug, planSlug),
        });

        if (plan) {
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);

          const existingSub = await tx.query.subscriptions.findFirst({
            where: eq(subscriptions.organizationId, paymentTx.organizationId),
          });

          if (existingSub) {
            await tx
              .update(subscriptions)
              .set({
                planId: plan.id,
                status: "active",
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                updatedAt: now,
              })
              .where(eq(subscriptions.id, existingSub.id));
          } else {
            await tx.insert(subscriptions).values({
              organizationId: paymentTx.organizationId,
              planId: plan.id,
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
            });
          }
        }
      }
    }

    if (paymentTx.invoiceId) {
      const invoice = await tx.query.invoices.findFirst({
        where: eq(invoices.id, paymentTx.invoiceId),
      });

      if (invoice) {
        const nextPaidCents = Number(invoice.amountPaidCents ?? 0) + args.verifiedAmountCents;
        const nextStatus = nextPaidCents >= Number(invoice.amountDueCents ?? 0) ? "paid" : "open";

        await tx
          .update(invoices)
          .set({
            amountPaidCents: nextPaidCents,
            status: nextStatus,
            paidAt: nextStatus === "paid" ? new Date() : invoice.paidAt,
          })
          .where(eq(invoices.id, invoice.id));

        await appendLedgerEntry(
          {
            organizationId: paymentTx.organizationId,
            invoiceId: invoice.id,
            paymentTransactionId: paymentTx.id,
            type: "payment",
            amountCents: args.verifiedAmountCents,
            currency: verifiedCurrency,
            description: `${args.provider} payment`,
            idempotencyKey: `payment:${paymentTx.id}:succeeded`,
            metadata: {
              provider: args.provider,
              providerReference: args.providerReference,
              rawProviderPayload: args.rawProviderPayload ?? null,
            },
          },
          tx,
        );

        if (nextStatus === "paid") {
          const existingReceipt = await tx.query.receipts.findFirst({
            where: eq(receipts.paymentTransactionId, paymentTx.id),
          });

          if (existingReceipt) {
            receiptId = existingReceipt.id;
          } else {
            const [receipt] = await tx
              .insert(receipts)
              .values({
                organizationId: paymentTx.organizationId,
                invoiceId: invoice.id,
                paymentTransactionId: paymentTx.id,
                number: generateReceiptNumber(),
                status: "issued",
                amountCents: args.verifiedAmountCents,
                currency: verifiedCurrency,
                metadata: {
                  provider: args.provider,
                  providerReference: args.providerReference,
                },
              })
              .returning();
            receiptId = receipt.id;
          }
        }
      }
    }

    return {
      result: "settled",
      paymentTransactionId: paymentTx.id,
      invoiceId: paymentTx.invoiceId,
      receiptId,
      status: "succeeded",
    };
  });
}
