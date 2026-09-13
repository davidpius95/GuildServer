import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { logger } from "../utils/logger";
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
export const workflowQueue = new Queue("workflows", { connection });
export function enqueueWorkflow(executionId: string, step = 0) {
  return workflowQueue.add("run", { executionId }, { jobId: `${executionId}-${step}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
}
/**
 * The worker is started explicitly at boot, not at import.
 *
 * A BullMQ worker holds an open Redis connection for as long as it lives.
 * Starting one at module load meant any file importing this module — the
 * workflow router, the workflow engine, and so the whole tRPC app router —
 * kept a live worker open. Jest then never exited, and because CI runs without
 * --forceExit, a backend job sat wedged for over three hours and stopped every
 * production deploy behind it.
 *
 * Enqueuing still works from anywhere: only the consumer is deferred.
 */
let workflowWorker: Worker | null = null;

export function startWorkflowWorker(): Worker {
  if (workflowWorker) return workflowWorker;
  workflowWorker = new Worker(
    "workflows",
    async (job) => {
      const { runExecution } = await import("../services/workflow-engine");
      await runExecution(job.data.executionId);
    },
    { connection, concurrency: 3 },
  );
  workflowWorker.on("error", (error) => logger.error("Workflow worker error", { error: error.message }));
  return workflowWorker;
}

/** Stop the worker, so a process that started one can exit. */
export async function stopWorkflowWorker(): Promise<void> {
  const current = workflowWorker;
  workflowWorker = null;
  if (current) await current.close().catch(() => undefined);
}

/** The running worker, or null when none was started. */
export function getWorkflowWorker(): Worker | null {
  return workflowWorker;
}
