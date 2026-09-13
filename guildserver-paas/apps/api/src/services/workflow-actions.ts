import { db, applications, services, databases, projects, members, deployments, databaseBackups, users } from "@guildserver/database";
import { and, eq } from "drizzle-orm";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import type { Context } from "../trpc/context";
import type { WorkflowStep } from "./workflow-definition";
import { workflowHttp } from "./workflow-http";

type ExecutionScope = { organizationId: string; triggeredBy: string | null };
/** Resolve the actual target in the execution's organization before invoking normal router permissions. */
export async function workflowCaller(scope: ExecutionScope, action: string, resourceId: string) {
  if (!scope.triggeredBy) throw new Error("The workflow initiator no longer exists.");
  const member = await db.query.members.findFirst({ where: and(eq(members.userId, scope.triggeredBy), eq(members.organizationId, scope.organizationId)) });
  if (!member || !["owner", "admin"].includes(member.role)) throw new Error("Workflow actions require organization owner or administrator access.");
  const resource = action === "application.deploy" ? await db.query.applications.findFirst({ where: eq(applications.id, resourceId) })
    : action === "stack.deploy" ? await db.query.services.findFirst({ where: eq(services.id, resourceId) })
      : await db.query.databases.findFirst({ where: eq(databases.id, resourceId) });
  const project = resource?.projectId && await db.query.projects.findFirst({ where: eq(projects.id, resource.projectId) });
  if (!project || project.organizationId !== scope.organizationId) throw new Error("Workflow resource not found in this organization.");
  const user = await db.query.users.findFirst({ where: eq(users.id, scope.triggeredBy) });
  if (!user) throw new Error("Workflow initiator not found.");
  const { appRouter } = await import("../trpc/router");
  const req = new IncomingMessage(new Socket()) as Context["req"];
  const res = new ServerResponse(req) as Context["res"];
  return appRouter.createCaller({ req, res, db, user, isAuthenticated: true, isAdmin: user.role === "admin", apiToken: undefined });
}
export async function runWorkflowAction(step: WorkflowStep, context: Record<string, any>, scope: ExecutionScope, persist: () => Promise<void>) {
  const action = String(step.config.action || step.config.type || "log");
  const key = `step_${step.id}`;
  if (action === "log") { context[key] = { status: "completed", message: String(step.config.message || step.name), at: new Date().toISOString() }; return; }
  if (action === "delay") { await new Promise(r => setTimeout(r, Number(step.config.ms))); context[key] = { status: "completed" }; return; }
  if (action === "http" || action === "webhook") {
    const status = await workflowHttp(step.config.url, step.config);
    const ok = status >= 200 && status < 300;
    context[key] = { status: ok ? "completed" : "failed", httpStatus: status };
    if (!ok) throw new Error(`HTTP action returned ${status}.`);
    return;
  }
  if (!["application.deploy", "stack.deploy", "database.backup"].includes(action)) throw new Error(`Unsupported workflow action: ${action}`);
  const caller = await workflowCaller(scope, action, step.config.resourceId);
  if (!context[key]?.operationId) {
    const result = action === "application.deploy" ? await caller.application.deploy({ id: step.config.resourceId })
      : action === "stack.deploy" ? await caller.service.deploy({ id: step.config.resourceId })
        : await caller.database.backup({ id: step.config.resourceId });
    context[key] = { status: "running", operationId: result.id, action, resourceId: step.config.resourceId };
    await persist();
  }
  // Completion means the underlying operation succeeded, not merely that it was queued.
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const id = context[key].operationId;
    const result = action === "database.backup" ? await db.query.databaseBackups.findFirst({ where: eq(databaseBackups.id, id) }) : await db.query.deployments.findFirst({ where: eq(deployments.id, id) });
    if (!result) throw new Error("Workflow operation no longer exists.");
    if (["completed", "success"].includes(result.status || "")) { context[key].status = "completed"; return; }
    if (["failed", "error", "cancelled"].includes(result.status || "")) { context[key].status = "failed"; throw new Error(`${step.name} failed. Open the linked operation for details.`); }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Operation exceeded the workflow wait limit. Check its deployment or backup history before retrying.");
}
