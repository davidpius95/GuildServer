import express from "express";
import request from "supertest";

const settleChargeFromProvider = jest.fn();

jest.mock("../../src/services/billing/flutterwave-v4", () => ({
  settleChargeFromProvider,
}));

jest.mock("../../src/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { flutterwaveV4WebhookRouter } from "../../src/handlers/flutterwave-v4-webhooks";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/", flutterwaveV4WebhookRouter);
  return app;
}

describe("flutterwaveV4WebhookRouter", () => {
  const previousSecret = process.env.FLW_V4_WEBHOOK_SECRET_HASH;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FLW_V4_WEBHOOK_SECRET_HASH = "test-secret";
    settleChargeFromProvider.mockResolvedValue({ result: "settled", paymentTransactionId: "payment-1", status: "succeeded" });
  });

  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.FLW_V4_WEBHOOK_SECRET_HASH;
    } else {
      process.env.FLW_V4_WEBHOOK_SECRET_HASH = previousSecret;
    }
  });

  it("rejects deliveries without the configured verification hash", async () => {
    await request(createApp())
      .post("/")
      .set("verif-hash", "wrong-secret")
      .send({ data: { id: "charge-1", reference: "GS-REF" } })
      .expect(401);

    expect(settleChargeFromProvider).not.toHaveBeenCalled();
  });

  it("acknowledges valid deliveries and calls shared settlement", async () => {
    await request(createApp())
      .post("/")
      .set("verif-hash", "test-secret")
      .send({ data: { id: "charge-1", reference: "GS-REF" } })
      .expect(200, { received: true });

    expect(settleChargeFromProvider).toHaveBeenCalledWith({
      chargeId: "charge-1",
      reference: "GS-REF",
    });
  });
});
