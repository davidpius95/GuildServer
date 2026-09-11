/**
 * Public REST API, version 1.
 *
 * Every request: authenticate the bearer token -> rate-limit it -> check the
 * scope -> confirm the resource is inside the token's organization and project
 * restriction (404 otherwise) -> call the SAME tRPC procedure the dashboard
 * calls, as the token's user, so REST and dashboard authorization cannot drift
 * -> redact credentials from the result.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, deployments } from "@guildserver/database";
import { appRouter } from "../../trpc/router";
import type { AuthenticatedToken } from "../../services/api-tokens";
import { authenticate, requireScope, tokenOf } from "./auth";
import { rateLimit } from "./rate-limit";
import { RestError, sendError, toRestError } from "./errors";
import { recordApiAction } from "./audit";
import { redact } from "./redact";
import {
  assertInReach,
  badRequest,
  ownerOfApplication,
  ownerOfDatabase,
  ownerOfDeployment,
  ownerOfProject,
  ownerOfService,
  projectInReach,
  requireUuid,
} from "./access";

type Handler = (req: Request, res: Response) => Promise<{ status?: number; data: unknown }>;

function handle(fn: Handler) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const { status = 200, data } = await fn(req, res);
      res.status(status).json({ data: redact(data) });
    } catch (error) {
      sendError(res, toRestError(error));
    }
  };
}

/**
 * A tRPC caller acting as the token's user. isAdmin is always false: a token
 * never carries platform-admin power, whoever created it. `apiToken` marks the
 * context so procedures that must refuse token callers (api-token management)
 * can tell.
 */
function callerFor(req: Request, res: Response, token: AuthenticatedToken) {
  return appRouter.createCaller({
    req,
    res,
    db,
    user: token.user,
    isAuthenticated: true,
    isAdmin: false,
    apiToken: { id: token.tokenId, organizationId: token.organizationId, scopes: token.scopes },
  } as any);
}

function tailParam(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1 || n > 5000) throw badRequest("tail must be an integer between 1 and 5000");
  return n;
}

export function createRestV1Router(): Router {
  const router = Router();
  router.use(authenticate, rateLimit);

  router.get("/me", requireScope("read"), handle(async (_req, res) => {
    const t = tokenOf(res);
    return { data: { tokenId: t.tokenId, organizationId: t.organizationId, userId: t.userId, scopes: t.scopes, projectIds: t.projectIds } };
  }));

  router.get("/projects", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    const rows = await callerFor(req, res, t).project.list({ organizationId: t.organizationId });
    return { data: (rows as any[]).filter((p) => projectInReach(t, p.id)) };
  }));

  router.get("/applications", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    const caller = callerFor(req, res, t);
    if (req.query.projectId !== undefined) {
      const projectId = String(req.query.projectId);
      assertInReach(t, await ownerOfProject(projectId));
      return { data: await caller.application.list({ projectId }) };
    }
    const rows = await caller.application.listByOrg({ organizationId: t.organizationId });
    return { data: (rows as any[]).filter((a) => projectInReach(t, a.projectId)) };
  }));

  router.get("/applications/:id", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfApplication(req.params.id));
    return { data: await callerFor(req, res, t).application.getById({ id: req.params.id }) };
  }));

  router.get("/applications/:id/deployments", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfApplication(req.params.id));
    // No procedure lists one application's deployments. Authorize through
    // getById first, then read the rows it has already proven access to.
    await callerFor(req, res, t).application.getById({ id: req.params.id });
    const rows = await db
      .select({
        id: deployments.id,
        applicationId: deployments.applicationId,
        status: deployments.status,
        deploymentType: deployments.deploymentType,
        imageTag: deployments.imageTag,
        gitCommitSha: deployments.gitCommitSha,
        triggeredBy: deployments.triggeredBy,
        isPreview: deployments.isPreview,
        strategy: deployments.strategy,
        startedAt: deployments.startedAt,
        completedAt: deployments.completedAt,
        createdAt: deployments.createdAt,
      })
      .from(deployments)
      .where(and(eq(deployments.applicationId, req.params.id)))
      .orderBy(desc(deployments.createdAt))
      .limit(100);
    return { data: rows };
  }));

  router.post("/applications/:id/deployments", requireScope("deploy"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfApplication(req.params.id));
    const gitCommitSha = typeof req.body?.gitCommitSha === "string" ? req.body.gitCommitSha : undefined;
    const deployment = await callerFor(req, res, t).application.deploy({ id: req.params.id, gitCommitSha });
    await recordApiAction(req, t, { action: "application.deploy", resourceType: "application", resourceId: req.params.id });
    return { status: 202, data: deployment };
  }));

  router.get("/applications/:id/logs", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfApplication(req.params.id));
    const lines = tailParam(req.query.tail, 100);
    return { data: await callerFor(req, res, t).application.getLogs({ id: req.params.id, lines }) };
  }));

  router.post("/applications/:id/restart", requireScope("deploy"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfApplication(req.params.id));
    const result = await callerFor(req, res, t).application.restart({ id: req.params.id });
    await recordApiAction(req, t, { action: "application.restart", resourceType: "application", resourceId: req.params.id });
    return { data: result };
  }));

  router.post("/applications/:id/stop", requireScope("deploy"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfApplication(req.params.id));
    const result = await callerFor(req, res, t).application.stop({ id: req.params.id });
    await recordApiAction(req, t, { action: "application.stop", resourceType: "application", resourceId: req.params.id });
    return { data: result };
  }));

  router.get("/deployments/:id", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfDeployment(req.params.id));
    return { data: await callerFor(req, res, t).deployment.getById({ id: req.params.id }) };
  }));

  router.get("/databases", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    const rows = await callerFor(req, res, t).database.listByOrg({ organizationId: t.organizationId });
    return { data: (rows as any[]).filter((d) => projectInReach(t, d.projectId)) };
  }));

  router.get("/databases/:id", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfDatabase(req.params.id));
    return { data: await callerFor(req, res, t).database.getById({ id: req.params.id }) };
  }));

  router.get("/services", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    const caller = callerFor(req, res, t);
    const projectRows = (await caller.project.list({ organizationId: t.organizationId })) as any[];
    const lists = await Promise.all(
      projectRows.filter((p) => projectInReach(t, p.id)).map((p) => caller.service.list({ projectId: p.id })),
    );
    return { data: lists.flat() };
  }));

  router.get("/services/:id", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfService(req.params.id));
    return { data: await callerFor(req, res, t).service.getById({ id: req.params.id }) };
  }));

  router.post("/services/:id/deployments", requireScope("deploy"), handle(async (req, res) => {
    const t = tokenOf(res);
    assertInReach(t, await ownerOfService(req.params.id));
    const deployment = await callerFor(req, res, t).service.deploy({ id: req.params.id });
    await recordApiAction(req, t, { action: "service.deploy", resourceType: "service", resourceId: req.params.id });
    return { status: 202, data: deployment };
  }));

  router.get("/domains", requireScope("read"), handle(async (req, res) => {
    const t = tokenOf(res);
    if (req.query.applicationId === undefined) throw badRequest("applicationId is required");
    const applicationId = requireUuid(String(req.query.applicationId));
    assertInReach(t, await ownerOfApplication(applicationId));
    return { data: await callerFor(req, res, t).domain.list({ applicationId }) };
  }));

  router.use((_req: Request, res: Response) => {
    sendError(res, new RestError("NOT_FOUND", "Endpoint not found"));
  });

  return router;
}
