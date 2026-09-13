import { createHmac } from "node:crypto";
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
  app.use(express.json({ verify: (req, _res, body) => { (req as any).rawBody = body; } }));
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
  it("returns retryable failure when settlement fails", async () => {
    settleChargeFromProvider.mockRejectedValueOnce(new Error("provider unavailable"));
    await request(createApp()).post("/").set("verif-hash", "test-secret").send({ type: "charge.completed", data: { id: "chg_1", reference: "GS-1" } }).expect(503);
  });
  it("verifies a current v4 signature over the exact raw body", async () => {
    const body = JSON.stringify({ type: "charge.completed", data: { id: "chg_1", reference: "GS-1" } });
    const signature = createHmac("sha256", "test-secret").update(body).digest("base64");
    await request(createApp()).post("/").set("Content-Type", "application/json").set("flutterwave-signature", signature).send(body).expect(200);
    expect(settleChargeFromProvider).toHaveBeenCalled();
  });
  it("does not fall back to legacy hash when a signed payload was altered", async () => {
    await request(createApp()).post("/").set("flutterwave-signature", "invalid").set("verif-hash", "test-secret").send({ data: { id: "chg_1" } }).expect(401);
    expect(settleChargeFromProvider).not.toHaveBeenCalled();
  });
  it("does not settle refunds or payout events as charges", async () => {
    await request(createApp()).post("/").set("verif-hash", "test-secret").send({ type: "transfer.completed", data: { id: "trf_1" } }).expect(200);
    expect(settleChargeFromProvider).not.toHaveBeenCalled();
  });

});
