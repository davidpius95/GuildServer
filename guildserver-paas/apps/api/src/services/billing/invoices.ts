import {
  billingLedgerEntries,
  db,
  invoiceLineItems,
  invoices,
  type Database,
} from "@guildserver/database";
import { eq } from "drizzle-orm";
import { appendLedgerEntry } from "./ledger";
import { normalizeCurrency } from "./money";

type DbLike = Database | any;

export type InvoiceWithLines = typeof invoices.$inferSelect & {
  lineItems: (typeof invoiceLineItems.$inferSelect)[];
};

export async function getInvoiceWithLines(
  invoiceId: string,
  database: DbLike = db,
): Promise<InvoiceWithLines | null> {
  const invoice = await database.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
  });
  if (!invoice) return null;

  const lineItems = await database.query.invoiceLineItems.findMany({
    where: eq(invoiceLineItems.invoiceId, invoiceId),
  });

  return { ...invoice, lineItems };
}

export async function recalculateInvoiceTotals(
  invoiceId: string,
  database: DbLike = db,
): Promise<void> {
  const lineItems = await database.query.invoiceLineItems.findMany({
    where: eq(invoiceLineItems.invoiceId, invoiceId),
  });

  const totalCents = lineItems.reduce((sum: number, line: any) => sum + Number(line.totalCents ?? 0), 0);
  const paid = await database.query.billingLedgerEntries?.findMany?.({
    where: eq(billingLedgerEntries.invoiceId, invoiceId),
  });
  const paidCents = Array.isArray(paid)
    ? paid
        .filter((entry) => entry.type === "payment")
        .reduce((sum, entry) => sum + Number(entry.amountCents ?? 0), 0)
    : 0;

  await database
    .update(invoices)
    .set({
      amountDueCents: Math.max(totalCents - paidCents, 0),
      amountPaidCents: paidCents,
      status: totalCents > 0 && paidCents >= totalCents ? "paid" : "open",
    })
    .where(eq(invoices.id, invoiceId));
}

export async function appendInvoiceChargeLedgerEntry(args: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  description?: string;
  database?: DbLike;
}) {
  return appendLedgerEntry({
    organizationId: args.organizationId,
    invoiceId: args.invoiceId,
    type: "charge",
    amountCents: args.amountCents,
    currency: normalizeCurrency(args.currency),
    description: args.description ?? "Invoice charge",
    idempotencyKey: `invoice:${args.invoiceId}:charge`,
  }, args.database);
}
