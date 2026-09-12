import { z } from "zod";
export const workflowStepSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(200),
  type: z.enum(["action", "approval"]), config: z.record(z.any()),
  nextSteps: z.array(z.string()).default([]),
}).superRefine((step, ctx) => {
  if (step.nextSteps.length) ctx.addIssue({ code: "custom", message: "Workflows run in listed order. Branching is not supported." });
  if (step.type !== "action") return;
  const action = step.config.action || step.config.type;
  if (!["log", "delay", "http", "webhook", "application.deploy", "stack.deploy", "database.backup"].includes(action)) ctx.addIssue({ code: "custom", message: `Unsupported workflow action: ${action}` });
  if (["application.deploy", "stack.deploy", "database.backup"].includes(action) && !z.string().uuid().safeParse(step.config.resourceId).success) ctx.addIssue({ code: "custom", message: "Choose a resource for the workflow action." });
  if (["http", "webhook"].includes(action) && !z.string().url().safeParse(step.config.url).success) ctx.addIssue({ code: "custom", message: "Provide a valid HTTP URL." });
  if (action === "delay" && (!Number.isFinite(Number(step.config.ms)) || Number(step.config.ms) < 0 || Number(step.config.ms) > 30000)) ctx.addIssue({ code: "custom", message: "Delay must be between 0 and 30000 milliseconds." });
});
export const workflowDefinitionSchema = z.object({
  steps: z.array(workflowStepSchema).min(1, "Add at least one configured step.").max(30),
  triggers: z.array(z.object({ type: z.literal("manual"), config: z.record(z.any()).default({}) })).default([]),
}).superRefine((definition, ctx) => {
  if (new Set(definition.steps.map(s => s.id)).size !== definition.steps.length) ctx.addIssue({ code: "custom", message: "Step IDs must be unique." });
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
