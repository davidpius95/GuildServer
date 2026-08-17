import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../utils/logger";
import { pollCryptoPaymentConfirmations, isCryptoConfigured } from "../services/billing";

// Self-contained Redis connection (mirrors queues/backups.ts).
const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const cryptoPaymentsQueue = new Queue("crypto-payments-poll", { connection: redis });

const POLL_JOB_ID = "crypto-payments-confirmation-sweep";

/** Register the repeatable confirmation-polling job (idempotent). Call once at boot. */
export async function initCryptoPaymentsPolling(): Promise<void> {
  if (!isCryptoConfigured()) {
    logger.info("Crypto payments not configured (CRYPTO_COLLECTION_WALLET_ADDRESS unset) — skipping poller");
    return;
  }
  await cryptoPaymentsQueue.add(
    "poll",
    {},
    { repeat: { every: 30_000 }, jobId: POLL_JOB_ID, removeOnComplete: 5, removeOnFail: 5 },
  );
  logger.info("Crypto payment confirmation poller scheduled (every 30s)");
}

new Worker(
  "crypto-payments-poll",
  async () => {
    await pollCryptoPaymentConfirmations();
  },
  { connection: redis },
).on("failed", (job, err) => {
  logger.error(`Crypto payment poll job failed: ${err.message}`);
});
