import { billingLedgerEntries, db } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { assertPositiveMinorAmount, normalizeCurrency } from "./money";

export type BillingLedgerEntry = typeof billingLedgerEntries.$inferSelect;

export interface AppendLedgerEntryArgs {
  organizationId: string;
  invoiceId?: string | null;
  paymentTransactionId?: string | null;
  receiptId?: string | null;
  type: "charge" | "payment" | "credit" | "refund" | "adjustment";
  amountCents: number;
  currency: string;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export async function appendLedgerEntry(args: AppendLedgerEntryArgs, database: any = db): Promise<BillingLedgerEntry> {
  assertPositiveMinorAmount(args.amountCents);
  const currency = normalizeCurrency(args.currency);

  try {
    const [entry] = await database
      .insert(billingLedgerEntries)
      .values({
        organizationId: args.organizationId,
        invoiceId: args.invoiceId ?? null,
        paymentTransactionId: args.paymentTransactionId ?? null,
        receiptId: args.receiptId ?? null,
        type: args.type,
        amountCents: args.amountCents,
        currency,
        description: args.description,
        idempotencyKey: args.idempotencyKey,
        metadata: args.metadata ?? {},
      })
      .returning();

    return entry;
  } catch (err: any) {
    if (err?.code !== "23505") throw err;

    const [existing] = await database
      .select()
      .from(billingLedgerEntries)
      .where(eq(billingLedgerEntries.idempotencyKey, args.idempotencyKey))
      .limit(1);

    if (!existing) throw err;
    return existing;
  }
}
