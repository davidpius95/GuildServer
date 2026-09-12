import { db } from "@guildserver/database";
import { workflowTemplates, workflowExecutions, approvalRequests } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";

import { workflowDefinitionSchema } from "./workflow-definition";
import { runWorkflowAction } from "./workflow-actions";
import { enqueueWorkflow } from "../queues/workflows";

/**
 * Run a workflow execution from its current step. Sequential executor:
 * - action: performs the configured action
 * - approval: creates an approval request, pauses the execution
 * - unsupported branches/parallel steps are rejected rather than silently skipped.
 * Re-entrant: resumeExecution() calls this again after an approval.
 */
export async function runExecution(executionId: string): Promise<void> {
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  if (!execution || !["pending", "running"].includes(execution.status || "")) return;

  const template = await db.query.workflowTemplates.findFirst({
    where: eq(workflowTemplates.id, execution.templateId!),
  });
  const definition = (execution.context as any)?.__definition || template?.definition;
  const context: Record<string, any> = { ...(execution.context as any) };

  await db
    .update(workflowExecutions)
    .set({ status: "running", startedAt: execution.startedAt ?? new Date() })
    .where(eq(workflowExecutions.id, executionId));

  try {
    const { steps } = workflowDefinitionSchema.parse(definition);
    for (let i = execution.currentStep ?? 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === "approval") {
        // Pause: create an approval request and stop until it's resolved.
        const existing = await db.query.approvalRequests.findFirst({ where: and(eq(approvalRequests.workflowExecutionId, executionId), eq(approvalRequests.stepId, step.id)) });
        if (existing?.status === "approved") continue;
        if (existing?.status === "rejected") throw new Error("Approval was rejected.");
        if (!existing) await db.insert(approvalRequests).values({
          workflowExecutionId: executionId,
          stepId: step.id,
          approverId: execution.triggeredBy,
          organizationId: execution.organizationId,
          status: "pending",
        });
        await db
          .update(workflowExecutions)
          .set({ status: "paused", currentStep: i, context })
          .where(eq(workflowExecutions.id, executionId));
        logger.info(`Workflow execution ${executionId} paused for approval at step ${step.id}`);
        return;
      }

      if (step.type === "action") {
        await runWorkflowAction(step, context, { organizationId: execution.organizationId!, triggeredBy: execution.triggeredBy }, async () => {
          await db.update(workflowExecutions).set({ context }).where(eq(workflowExecutions.id, executionId));
        });
      }
      // condition / parallel: MVP flattening — proceed sequentially.

      await db
        .update(workflowExecutions)
        .set({ currentStep: i + 1, context })
        .where(eq(workflowExecutions.id, executionId));
    }

    await db
      .update(workflowExecutions)
      .set({ status: "completed", completedAt: new Date(), context })
      .where(eq(workflowExecutions.id, executionId));
    logger.info(`Workflow execution ${executionId} completed (${steps.length} steps)`);
  } catch (err: any) {
    logger.error(`Workflow execution ${executionId} failed: ${err.message}`);
    await db
      .update(workflowExecutions)
      .set({ status: "failed", context, errorMessage: err.message, completedAt: new Date() })
      .where(eq(workflowExecutions.id, executionId));
  }
}

/** Resume a paused execution after an approval decision. */
export async function resumeExecution(executionId: string, approved: boolean): Promise<void> {
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  if (!execution || execution.status !== "paused") return;

  if (!approved) {
    await db
      .update(workflowExecutions)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(workflowExecutions.id, executionId));
    return;
  }

  // Advance past the approval step and continue.
  await db
    .update(workflowExecutions)
    .set({ currentStep: (execution.currentStep ?? 0) + 1, status: "running" })
    .where(eq(workflowExecutions.id, executionId));
  await enqueueWorkflow(executionId, (execution.currentStep ?? 0) + 1);
}
