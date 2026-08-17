import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../utils/logger";
import { provisionInstance, destroyInstance } from "../services/instance-provision";

// Self-contained Redis connection (mirrors queues/setup.ts) so this module is
// independent and does not affect the existing deployment queue/worker.
const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const instanceQueue = new Queue("instances", { connection: redis });

type InstanceJob =
  | { type: "provision"; instanceId: string }
  | { type: "destroy"; instanceId: string };

export async function addInstanceProvisionJob(instanceId: string) {
  return instanceQueue.add(
    "provision",
    { type: "provision", instanceId } satisfies InstanceJob,
    { removeOnComplete: 50, removeOnFail: 50, attempts: 2, backoff: { type: "exponential", delay: 5000 } },
  );
}

export async function addInstanceDestroyJob(instanceId: string) {
  return instanceQueue.add(
    "destroy",
    { type: "destroy", instanceId } satisfies InstanceJob,
    { removeOnComplete: 50, removeOnFail: 50, attempts: 2, backoff: { type: "exponential", delay: 5000 } },
  );
}

// Worker is created on module load (same pattern as the deployment worker).
const instanceWorker = new Worker(
  "instances",
  async (job) => {
    const data = job.data as InstanceJob;
    logger.info("Processing instance job", { jobId: job.id, type: data.type, instanceId: data.instanceId });
    if (data.type === "provision") {
      await provisionInstance(data.instanceId);
    } else if (data.type === "destroy") {
      await destroyInstance(data.instanceId);
    }
  },
  { connection: redis, concurrency: 3 },
);

instanceWorker.on("failed", (job, err) => {
  logger.error("Instance job failed", { jobId: job?.id, error: err?.message });
});

export { instanceWorker };
