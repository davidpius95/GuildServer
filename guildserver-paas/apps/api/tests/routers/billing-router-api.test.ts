const createBillingQuote = jest.fn();
const startFlutterwaveCharge = jest.fn();
const isStripeConfigured = jest.fn();
const isFlutterwaveV4Configured = jest.fn();

jest.mock("../../src/services/billing", () => ({
  isStripeConfigured,
  createCheckoutSession: jest.fn(),
  createPortalSession: jest.fn(),
  cancelSubscription: jest.fn(),
  resumeSubscription: jest.fn(),
}));

jest.mock("../../src/services/billing/flutterwave-v4-client", () => ({
  isFlutterwaveV4Configured,
}));

jest.mock("../../src/services/billing/flutterwave-v4", () => ({
  createFlutterwaveCharge: startFlutterwaveCharge,
  createVirtualAccount: jest.fn(),
  listVirtualAccounts: jest.fn(),
  listBanks: jest.fn(),
}));

jest.mock("../../src/services/billing/quotes", () => ({
  createQuote: createBillingQuote,
  acceptQuote: jest.fn(),
}));

jest.mock("../../src/services/billing/invoices", () => ({
  getInvoiceWithLines: jest.fn(),
}));

import { billingRouter } from "../../src/routers/billing";

function createCaller(db: any, user: any = { id: "user-1" }) {
  return billingRouter.createCaller({
    db,
    user,
    isAuthenticated: Boolean(user),
    isAdmin: false,
  } as any);
}

function createDb(member: any = { role: "owner", userId: "user-1", organizationId: "org-1" }) {
  return {
    query: {
      members: {
        findFirst: jest.fn(async () => member),
      },
      invoices: {
        findFirst: jest.fn(async () => ({
          id: "11111111-1111-4111-8111-111111111111",
          organizationId: "22222222-2222-4222-8222-222222222222",
          status: "open",
          amountDueCents: 120000,
          amountPaidCents: 20000,
          currency: "ngn",
          number: "INV-1",
        })),
      },
      quotes: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
      receipts: {
        findMany: jest.fn(async () => []),
      },
    },
  };
}

describe("billing router API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isStripeConfigured.mockReturnValue(true);
    isFlutterwaveV4Configured.mockReturnValue(true);
    createBillingQuote.mockResolvedValue({ id: "quote-1" });
    startFlutterwaveCharge.mockResolvedValue({ paymentTransactionId: "payment-1", reference: "GS-INVOICE" });
  });

  it("reports configured payment providers without exposing secrets", async () => {
    const caller = createCaller(createDb());

    await expect(caller.getPaymentProviders()).resolves.toEqual({
      stripe: true,
      flutterwave: true,
      crypto: false,
    });
  });

  it("allows organization admins to create quotes", async () => {
    const db = createDb({ role: "admin", userId: "user-1", organizationId: "22222222-2222-4222-8222-222222222222" });
    const caller = createCaller(db);

    await caller.createQuote({
      organizationId: "22222222-2222-4222-8222-222222222222",
      currency: "USD",
      lineItems: [
        {
          productType: "plan",
          description: "Pro monthly",
          quantity: 1,
          unitAmountCents: 5000,
        },
      ],
    });

    expect(createBillingQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "22222222-2222-4222-8222-222222222222",
        currency: "USD",
        database: db,
      }),
    );
  });

  it("rejects quote creation for non-admin members", async () => {
    const caller = createCaller(createDb({ role: "member", userId: "user-1", organizationId: "22222222-2222-4222-8222-222222222222" }));

    await expect(
      caller.createQuote({
        organizationId: "22222222-2222-4222-8222-222222222222",
        currency: "USD",
        lineItems: [{ productType: "plan", description: "Pro monthly", unitAmountCents: 5000 }],
      }),
    ).rejects.toThrow("Only organization owners or admins can manage billing");
  });

  it("starts Flutterwave payment for the remaining invoice balance", async () => {
    const caller = createCaller(createDb({ role: "owner", userId: "user-1", organizationId: "22222222-2222-4222-8222-222222222222" }));

    await caller.payInvoiceWithFlutterwave({
      organizationId: "22222222-2222-4222-8222-222222222222",
      invoiceId: "11111111-1111-4111-8111-111111111111",
      paymentMethod: "card",
    });

    expect(startFlutterwaveCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "22222222-2222-4222-8222-222222222222",
        invoiceId: "11111111-1111-4111-8111-111111111111",
        amountCents: 100000,
        currency: "ngn",
        purpose: "invoice",
        paymentMethod: "card",
      }),
    );
  });
});
