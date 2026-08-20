import {
  db,
  invoiceLineItems,
  invoices,
  quoteLineItems,
  quotes,
  type Database,
} from "@guildserver/database";
import { eq } from "drizzle-orm";
import { appendInvoiceChargeLedgerEntry, getInvoiceWithLines, type InvoiceWithLines } from "./invoices";
import { assertPositiveMinorAmount, normalizeCurrency } from "./money";

type DbLike = Database | any;

export interface QuoteLineInput {
  productType: string;
  productId?: string | null;
  description: string;
  quantity?: number;
  unitAmountCents: number;
  taxCents?: number;
  discountCents?: number;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface CreateQuoteArgs {
  organizationId: string;
  currency: string;
  lineItems: QuoteLineInput[];
  validUntil?: Date | null;
  metadata?: Record<string, unknown>;
  database?: DbLike;
}

export interface AcceptQuoteArgs {
  quoteId: string;
  acceptedBy: string;
  now?: Date;
  database?: DbLike;
}

export type QuoteWithLines = typeof quotes.$inferSelect & {
  lineItems: (typeof quoteLineItems.$inferSelect)[];
};

function generateBillingNumber(prefix: "Q" | "INV"): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

export function calculateQuoteLineTotals(line: QuoteLineInput) {
  const quantity = line.quantity ?? 1;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive number");
  }
  assertPositiveMinorAmount(line.unitAmountCents);

  const subtotalCents = Math.round(line.unitAmountCents * quantity);
  const taxCents = line.taxCents ?? 0;
  const discountCents = line.discountCents ?? 0;

  if (!Number.isInteger(taxCents) || taxCents < 0) {
    throw new Error("taxCents must be a non-negative integer");
  }
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw new Error("discountCents must be a non-negative integer");
  }
  if (discountCents > subtotalCents + taxCents) {
    throw new Error("discountCents cannot exceed line subtotal plus tax");
  }

  return {
    quantity,
    subtotalCents,
    taxCents,
    discountCents,
    totalCents: subtotalCents + taxCents - discountCents,
  };
}

export async function createQuote(args: CreateQuoteArgs): Promise<QuoteWithLines> {
  if (!args.lineItems.length) {
    throw new Error("quote requires at least one line item");
  }

  const database = args.database ?? db;
  const currency = normalizeCurrency(args.currency);
  const preparedLines = args.lineItems.map((line) => {
    if (!line.productType.trim()) throw new Error("productType is required");
    if (!line.description.trim()) throw new Error("description is required");
    return { input: line, totals: calculateQuoteLineTotals(line) };
  });

  const totals = preparedLines.reduce(
    (acc, line) => ({
      subtotalCents: acc.subtotalCents + line.totals.subtotalCents,
      taxCents: acc.taxCents + line.totals.taxCents,
      discountCents: acc.discountCents + line.totals.discountCents,
      totalCents: acc.totalCents + line.totals.totalCents,
    }),
    { subtotalCents: 0, taxCents: 0, discountCents: 0, totalCents: 0 },
  );

  return database.transaction(async (tx: DbLike) => {
    const [quote] = await tx
      .insert(quotes)
      .values({
        organizationId: args.organizationId,
        number: generateBillingNumber("Q"),
        status: "draft",
        currency,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        validUntil: args.validUntil ?? null,
        metadata: args.metadata ?? {},
      })
      .returning();

    const insertedLines = await tx
      .insert(quoteLineItems)
      .values(
        preparedLines.map(({ input, totals: lineTotals }) => ({
          quoteId: quote.id,
          organizationId: args.organizationId,
          productType: input.productType,
          productId: input.productId ?? null,
          description: input.description,
          quantity: String(lineTotals.quantity),
          unitAmountCents: input.unitAmountCents,
          subtotalCents: lineTotals.subtotalCents,
          taxCents: lineTotals.taxCents,
          discountCents: lineTotals.discountCents,
          totalCents: lineTotals.totalCents,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          metadata: input.metadata ?? {},
        })),
      )
      .returning();

    return { ...quote, lineItems: insertedLines };
  });
}

export async function createInvoiceFromQuote(args: {
  quote: QuoteWithLines;
  acceptedBy: string;
  now: Date;
  database: DbLike;
}): Promise<InvoiceWithLines> {
  const status = args.quote.totalCents > 0 ? "open" : "paid";
  const [invoice] = await args.database
    .insert(invoices)
    .values({
      organizationId: args.quote.organizationId,
      number: generateBillingNumber("INV"),
      status,
      amountDueCents: args.quote.totalCents,
      amountPaidCents: status === "paid" ? args.quote.totalCents : 0,
      currency: normalizeCurrency(args.quote.currency),
      createdAt: args.now,
    })
    .returning();

  const insertedLines = await args.database
    .insert(invoiceLineItems)
    .values(
      args.quote.lineItems.map((line) => ({
        invoiceId: invoice.id,
        quoteLineItemId: line.id,
        organizationId: args.quote.organizationId,
        productType: line.productType,
        productId: line.productId ?? null,
        description: line.description,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        subtotalCents: line.subtotalCents,
        taxCents: line.taxCents,
        discountCents: line.discountCents,
        totalCents: line.totalCents,
        periodStart: line.periodStart ?? null,
        periodEnd: line.periodEnd ?? null,
        metadata: line.metadata ?? {},
      })),
    )
    .returning();

  if (args.quote.totalCents > 0) {
    await appendInvoiceChargeLedgerEntry({
      organizationId: args.quote.organizationId,
      invoiceId: invoice.id,
      amountCents: args.quote.totalCents,
      currency: args.quote.currency,
      database: args.database,
    });
  }

  await args.database
    .update(quotes)
    .set({
      status: "accepted",
      acceptedAt: args.now,
      acceptedBy: args.acceptedBy,
      invoiceId: invoice.id,
      updatedAt: args.now,
    })
    .where(eq(quotes.id, args.quote.id));

  return { ...invoice, lineItems: insertedLines };
}

export async function acceptQuote(args: AcceptQuoteArgs): Promise<InvoiceWithLines> {
  const database = args.database ?? db;
  const now = args.now ?? new Date();

  return database.transaction(async (tx: DbLike) => {
    const quote = await tx.query.quotes.findFirst({
      where: eq(quotes.id, args.quoteId),
      with: { lineItems: true },
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    if (quote.status === "accepted" && quote.invoiceId) {
      const existing = await getInvoiceWithLines(quote.invoiceId, tx);
      if (!existing) throw new Error("Accepted quote invoice not found");
      return existing;
    }

    if (quote.validUntil && new Date(quote.validUntil).getTime() < now.getTime()) {
      await tx.update(quotes).set({ status: "expired", updatedAt: now }).where(eq(quotes.id, quote.id));
      throw new Error("Quote has expired");
    }

    if (!["draft", "sent"].includes(quote.status)) {
      throw new Error(`Quote cannot be accepted from status ${quote.status}`);
    }

    return createInvoiceFromQuote({
      quote,
      acceptedBy: args.acceptedBy,
      now,
      database: tx,
    });
  });
}
