const mockState: { db?: any } = {};

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

jest.mock("@guildserver/database", () => {
  const table = (name: string) => ({
    __name: name,
    id: `${name}.id`,
    invoiceId: `${name}.invoiceId`,
    idempotencyKey: `${name}.idempotencyKey`,
  });

  const db = {
    transaction: jest.fn(),
  };
  mockState.db = db;

  return {
    db,
    quotes: table("quotes"),
    quoteLineItems: table("quote_line_items"),
    invoices: table("invoices"),
    invoiceLineItems: table("invoice_line_items"),
    billingLedgerEntries: table("billing_ledger_entries"),
  };
});

import { acceptQuote, calculateQuoteLineTotals, createQuote } from "../../src/services/billing/quotes";

function createReturningBuilder(result: unknown[]) {
  return {
    values: jest.fn(() => ({
      returning: jest.fn(async () => result),
    })),
  };
}

function createUpdateBuilder(updates: unknown[]) {
  return {
    set: jest.fn((value) => ({
      where: jest.fn(async () => {
        updates.push(value);
      }),
    })),
  };
}

function createTx(options: {
  quote?: any;
  existingInvoice?: any;
  existingInvoiceLines?: any[];
} = {}) {
  const updates: unknown[] = [];
  const inserted: Record<string, unknown[]> = {};

  const tx = {
    updates,
    inserted,
    query: {
      quotes: {
        findFirst: jest.fn(async () => options.quote ?? null),
      },
      invoices: {
        findFirst: jest.fn(async () => options.existingInvoice ?? null),
      },
      invoiceLineItems: {
        findMany: jest.fn(async () => options.existingInvoiceLines ?? []),
      },
      billingLedgerEntries: {
        findMany: jest.fn(async () => []),
      },
    },
    insert: jest.fn((table: any) => {
      if (table.__name === "quotes") {
        return {
          values: jest.fn((value) => {
            inserted.quotes = [value];
            return { returning: jest.fn(async () => [{ id: "quote-1", ...value }]) };
          }),
        };
      }

      if (table.__name === "quote_line_items") {
        return {
          values: jest.fn((value) => {
            inserted.quoteLineItems = value;
            return {
              returning: jest.fn(async () =>
                value.map((line: any, index: number) => ({ id: `quote-line-${index + 1}`, ...line })),
              ),
            };
          }),
        };
      }

      if (table.__name === "invoices") {
        return {
          values: jest.fn((value) => {
            inserted.invoices = [value];
            return { returning: jest.fn(async () => [{ id: "invoice-1", ...value }]) };
          }),
        };
      }

      if (table.__name === "invoice_line_items") {
        return {
          values: jest.fn((value) => {
            inserted.invoiceLineItems = value;
            return {
              returning: jest.fn(async () =>
                value.map((line: any, index: number) => ({ id: `invoice-line-${index + 1}`, ...line })),
              ),
            };
          }),
        };
      }

      if (table.__name === "billing_ledger_entries") {
        return {
          values: jest.fn((value) => {
            inserted.billingLedgerEntries = [value];
            return { returning: jest.fn(async () => [{ id: "ledger-1", ...value }]) };
          }),
        };
      }

      return createReturningBuilder([]);
    }),
    update: jest.fn(() => createUpdateBuilder(updates)),
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => []),
        })),
      })),
    })),
  };

  return tx;
}

describe("billing quote services", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calculates line totals from immutable input snapshots", () => {
    expect(
      calculateQuoteLineTotals({
        productType: "plan",
        description: "Pro monthly",
        quantity: 2,
        unitAmountCents: 2500,
        taxCents: 500,
        discountCents: 1000,
      }),
    ).toEqual({
      quantity: 2,
      subtotalCents: 5000,
      taxCents: 500,
      discountCents: 1000,
      totalCents: 4500,
    });
  });

  it("creates a quote with persisted line snapshots and totals", async () => {
    const tx = createTx();
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const quote = await createQuote({
      organizationId: "org-1",
      currency: "NGN",
      lineItems: [
        {
          productType: "instance",
          productId: "gs-s3",
          description: "Shared instance",
          quantity: 2,
          unitAmountCents: 120000,
        },
      ],
    });

    expect(quote.currency).toBe("ngn");
    expect(quote.subtotalCents).toBe(240000);
    expect(quote.totalCents).toBe(240000);
    expect(quote.lineItems).toHaveLength(1);
    expect(tx.inserted.quoteLineItems[0]).toMatchObject({
      quoteId: "quote-1",
      organizationId: "org-1",
      productType: "instance",
      quantity: "2",
      totalCents: 240000,
    });
  });

  it("accepts a quote into one invoice with copied invoice line items", async () => {
    const now = new Date("2026-08-20T12:00:00Z");
    const tx = createTx({
      quote: {
        id: "quote-1",
        organizationId: "org-1",
        status: "sent",
        currency: "usd",
        subtotalCents: 5000,
        taxCents: 0,
        discountCents: 0,
        totalCents: 5000,
        validUntil: new Date("2026-08-21T12:00:00Z"),
        lineItems: [
          {
            id: "quote-line-1",
            productType: "plan",
            productId: "pro",
            description: "Pro monthly",
            quantity: "1",
            unitAmountCents: 5000,
            subtotalCents: 5000,
            taxCents: 0,
            discountCents: 0,
            totalCents: 5000,
            metadata: {},
          },
        ],
      },
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const invoice = await acceptQuote({
      quoteId: "quote-1",
      acceptedBy: "user-1",
      now,
    });

    expect(invoice.id).toBe("invoice-1");
    expect(invoice.status).toBe("open");
    expect(invoice.amountDueCents).toBe(5000);
    expect(tx.inserted.invoiceLineItems[0]).toMatchObject({
      invoiceId: "invoice-1",
      quoteLineItemId: "quote-line-1",
      productType: "plan",
      totalCents: 5000,
    });
    expect(tx.inserted.billingLedgerEntries[0]).toMatchObject({
      organizationId: "org-1",
      invoiceId: "invoice-1",
      type: "charge",
      amountCents: 5000,
      idempotencyKey: "invoice:invoice-1:charge",
    });
    expect(tx.updates[0]).toMatchObject({
      status: "accepted",
      acceptedAt: now,
      acceptedBy: "user-1",
      invoiceId: "invoice-1",
    });
  });

  it("does not accept expired quotes", async () => {
    const tx = createTx({
      quote: {
        id: "quote-1",
        organizationId: "org-1",
        status: "sent",
        currency: "usd",
        totalCents: 5000,
        validUntil: new Date("2026-08-19T12:00:00Z"),
        lineItems: [],
      },
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(
      acceptQuote({
        quoteId: "quote-1",
        acceptedBy: "user-1",
        now: new Date("2026-08-20T12:00:00Z"),
      }),
    ).rejects.toThrow("Quote has expired");

    expect(tx.inserted.invoices).toBeUndefined();
    expect(tx.updates[0]).toMatchObject({ status: "expired" });
  });

  it("returns the existing invoice when an accepted quote is replayed", async () => {
    const tx = createTx({
      quote: {
        id: "quote-1",
        status: "accepted",
        invoiceId: "invoice-1",
      },
      existingInvoice: {
        id: "invoice-1",
        organizationId: "org-1",
        status: "open",
        amountDueCents: 5000,
      },
      existingInvoiceLines: [{ id: "invoice-line-1", invoiceId: "invoice-1" }],
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const invoice = await acceptQuote({
      quoteId: "quote-1",
      acceptedBy: "user-1",
    });

    expect(invoice.id).toBe("invoice-1");
    expect(invoice.lineItems).toHaveLength(1);
    expect(tx.inserted.invoices).toBeUndefined();
  });
});
