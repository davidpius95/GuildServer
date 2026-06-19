import { db } from "@guildserver/database";
import { workflowTemplates, workflowExecutions, approvalRequests } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

interface WorkflowStep {
  id: string;
  name: string;
  type: "action" | "approval" | "condition" | "parallel";
  config: Record<string, any>;
  nextSteps?: string[];
}

/** Execute a single action step. Supports a small, safe set of action types. */
async function runAction(step: WorkflowStep, context: Record<string, any>): Promise<void> {
  const action = String(step.config?.action || step.config?.type || "log");
  switch (action) {
    case "http":
    case "webhook": {
      const url = step.config?.url;
      if (!url) throw new Error(`Step "${step.name}" missing config.url`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          method: step.config?.method || "POST",
          headers: step.config?.headers || { "Content-Type": "application/json" },
          body: step.config?.body ? JSON.stringify(step.config.body) : undefined,
          signal: controller.signal,
        });
        context[`step_${step.id}`] = { status: res.status, ok: res.ok };
      } finally {
        clearTimeout(timer);
      }
      break;
    }
    case "delay": {
      const ms = Math.min(Number(step.config?.ms) || 1000, 30000);
      await new Promise((r) => setTimeout(r, ms));
      break;
    }
    default: {
      // log / no-op action — record that the step ran
      context[`step_${step.id}`] = { ran: true, name: step.name, at: new Date().toISOString() };
    }
  }
}

/**
 * Run a workflow execution from its current step. Sequential executor:
 * - action: performs the configured action
 * - approval: creates an approval request, pauses the execution
 * - condition/parallel: evaluated/flattened sequentially (MVP)
 * Re-entrant: resumeExecution() calls this again after an approval.
 */
export async function runExecution(executionId: string): Promise<void> {
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
  });
  if (!execution) return;

  const template = await db.query.workflowTemplates.findFirst({
    where: eq(workflowTemplates.id, execution.templateId!),
  });
  const steps: WorkflowStep[] = ((template?.definition as any)?.steps as WorkflowStep[]) || [];
  const context: Record<string, any> = { ...(execution.context as any) };

  await db
    .update(workflowExecutions)
    .set({ status: "running", startedAt: execution.startedAt ?? new Date() })
    .where(eq(workflowExecutions.id, executionId));

  try {
    for (let i = execution.currentStep ?? 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === "approval") {
        // Pause: create an approval request and stop until it's resolved.
        await db.insert(approvalRequests).values({
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
        await runAction(step, context);
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
      .set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
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
    .set({ currentStep: (execution.currentStep ?? 0) + 1 })
    .where(eq(workflowExecutions.id, executionId));
  await runExecution(executionId);
}
