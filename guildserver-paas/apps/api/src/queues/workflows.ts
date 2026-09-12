import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../utils/logger";
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
export const workflowQueue = new Queue("workflows", { connection });
export function enqueueWorkflow(executionId: string, step = 0) {
  return workflowQueue.add("run", { executionId }, { jobId: `${executionId}-${step}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
}
export const workflowWorker = new Worker("workflows", async job => {
  const { runExecution } = await import("../services/workflow-engine");
  await runExecution(job.data.executionId);
}, { connection, concurrency: 3 });
workflowWorker.on("error", error => logger.error("Workflow worker error", { error: error.message }));
