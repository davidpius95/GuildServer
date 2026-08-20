const mockState: { db?: any } = {};

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

jest.mock("@guildserver/database", () => {
  const table = (name: string) => ({
    __name: name,
    id: `${name}.id`,
    invoiceId: `${name}.invoiceId`,
    paymentTransactionId: `${name}.paymentTransactionId`,
    idempotencyKey: `${name}.idempotencyKey`,
    flutterwaveTxRef: `${name}.flutterwaveTxRef`,
    flutterwaveTxId: `${name}.flutterwaveTxId`,
  });

  const db = { transaction: jest.fn() };
  mockState.db = db;

  return {
    db,
    invoices: table("invoices"),
    paymentTransactions: table("payment_transactions"),
    receipts: table("receipts"),
    billingLedgerEntries: table("billing_ledger_entries"),
  };
});

import { settlePaymentAttempt } from "../../src/services/billing/settlement";

function createUpdateBuilder(updates: Record<string, unknown[]>, tableName: string) {
  return {
    set: jest.fn((value) => ({
      where: jest.fn(async () => {
        updates[tableName] = updates[tableName] ?? [];
        updates[tableName].push(value);
      }),
    })),
  };
}

function createTx(options: {
  paymentTx?: any;
  invoice?: any;
  existingReceipt?: any;
} = {}) {
  const updates: Record<string, unknown[]> = {};
  const inserted: Record<string, unknown[]> = {};

  const tx = {
    updates,
    inserted,
    query: {
      paymentTransactions: {
        findFirst: jest.fn(async () => options.paymentTx ?? null),
      },
      invoices: {
        findFirst: jest.fn(async () => options.invoice ?? null),
      },
      receipts: {
        findFirst: jest.fn(async () => options.existingReceipt ?? null),
      },
    },
    update: jest.fn((table: any) => createUpdateBuilder(updates, table.__name)),
    insert: jest.fn((table: any) => ({
      values: jest.fn((value) => {
        inserted[table.__name] = inserted[table.__name] ?? [];
        inserted[table.__name].push(value);
        return {
          returning: jest.fn(async () => [{ id: `${table.__name}-1`, ...value }]),
        };
      }),
    })),
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

describe("settlePaymentAttempt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("settles a successful invoice payment once", async () => {
    const tx = createTx({
      paymentTx: {
        id: "payment-1",
        organizationId: "org-1",
        invoiceId: "invoice-1",
        provider: "flutterwave",
        status: "pending",
        amountCents: 5000,
        currency: "usd",
      },
      invoice: {
        id: "invoice-1",
        amountDueCents: 5000,
        amountPaidCents: 0,
        paidAt: null,
      },
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await settlePaymentAttempt({
      provider: "flutterwave",
      providerReference: "flw-charge-1",
      paymentTransactionId: "payment-1",
      verifiedStatus: "succeeded",
      verifiedAmountCents: 5000,
      verifiedCurrency: "USD",
      providerPaymentMethodDetail: "card",
    });

    expect(result).toMatchObject({
      result: "settled",
      paymentTransactionId: "payment-1",
      invoiceId: "invoice-1",
      status: "succeeded",
    });
    expect(tx.updates.payment_transactions[0]).toMatchObject({
      status: "succeeded",
      flutterwaveTxId: "flw-charge-1",
      paymentMethodDetail: "card",
    });
    expect(tx.updates.invoices[0]).toMatchObject({
      amountPaidCents: 5000,
      status: "paid",
    });
    expect(tx.inserted.billing_ledger_entries[0]).toMatchObject({
      organizationId: "org-1",
      invoiceId: "invoice-1",
      paymentTransactionId: "payment-1",
      type: "payment",
      amountCents: 5000,
      idempotencyKey: "payment:payment-1:succeeded",
    });
    expect(tx.inserted.receipts[0]).toMatchObject({
      organizationId: "org-1",
      invoiceId: "invoice-1",
      paymentTransactionId: "payment-1",
      amountCents: 5000,
      status: "issued",
    });
  });

  it("ignores replayed successful payments and returns the existing receipt", async () => {
    const tx = createTx({
      paymentTx: {
        id: "payment-1",
        organizationId: "org-1",
        invoiceId: "invoice-1",
        provider: "flutterwave",
        status: "succeeded",
        amountCents: 5000,
        currency: "usd",
      },
      existingReceipt: { id: "receipt-1" },
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await settlePaymentAttempt({
      provider: "flutterwave",
      providerReference: "flw-charge-1",
      paymentTransactionId: "payment-1",
      verifiedStatus: "succeeded",
      verifiedAmountCents: 5000,
      verifiedCurrency: "usd",
    });

    expect(result).toMatchObject({
      result: "ignored",
      reason: "already succeeded",
      receiptId: "receipt-1",
    });
    expect(tx.inserted.receipts).toBeUndefined();
    expect(tx.inserted.billing_ledger_entries).toBeUndefined();
  });

  it("fails underpaid successful provider payments", async () => {
    const tx = createTx({
      paymentTx: {
        id: "payment-1",
        organizationId: "org-1",
        invoiceId: "invoice-1",
        provider: "flutterwave",
        status: "pending",
        amountCents: 5000,
        currency: "usd",
      },
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await settlePaymentAttempt({
      provider: "flutterwave",
      providerReference: "flw-charge-1",
      paymentTransactionId: "payment-1",
      verifiedStatus: "succeeded",
      verifiedAmountCents: 3000,
      verifiedCurrency: "usd",
    });

    expect(result).toMatchObject({ result: "settled", status: "failed", reason: "underpaid" });
    expect(tx.updates.payment_transactions[0]).toMatchObject({
      status: "failed",
      failureReason: "Underpaid: expected 5000, received 3000",
    });
    expect(tx.inserted.receipts).toBeUndefined();
  });

  it("fails payments with the wrong verified currency", async () => {
    const tx = createTx({
      paymentTx: {
        id: "payment-1",
        organizationId: "org-1",
        invoiceId: "invoice-1",
        provider: "stripe",
        status: "pending",
        amountCents: 5000,
        currency: "usd",
      },
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await settlePaymentAttempt({
      provider: "stripe",
      providerReference: "pi_123",
      paymentTransactionId: "payment-1",
      verifiedStatus: "succeeded",
      verifiedAmountCents: 5000,
      verifiedCurrency: "ngn",
    });

    expect(result).toMatchObject({ result: "settled", status: "failed", reason: "currency mismatch" });
    expect(tx.updates.payment_transactions[0]).toMatchObject({
      status: "failed",
      failureReason: "Currency mismatch: expected usd, received ngn",
    });
  });

  it("preserves failed provider status without issuing a receipt", async () => {
    const tx = createTx({
      paymentTx: {
        id: "payment-1",
        organizationId: "org-1",
        invoiceId: "invoice-1",
        provider: "stripe",
        status: "processing",
        amountCents: 5000,
        currency: "usd",
      },
    });
    mockState.db!.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await settlePaymentAttempt({
      provider: "stripe",
      providerReference: "pi_123",
      paymentTransactionId: "payment-1",
      verifiedStatus: "failed",
      verifiedAmountCents: 0,
      verifiedCurrency: "usd",
      failureReason: "card declined",
    });

    expect(result).toMatchObject({ result: "settled", status: "failed" });
    expect(tx.updates.payment_transactions[0]).toMatchObject({
      status: "failed",
      failureReason: "card declined",
    });
    expect(tx.inserted.receipts).toBeUndefined();
  });
});
