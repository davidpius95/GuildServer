import { createTRPCRouter } from "./trpc";
import { authRouter } from "../routers/auth";
import { organizationRouter } from "../routers/organization";
import { projectRouter } from "../routers/project";
import { applicationRouter } from "../routers/application";
import { databaseRouter } from "../routers/database";
import { deploymentRouter } from "../routers/deployment";
import { userRouter } from "../routers/user";
import { kubernetesRouter } from "../routers/kubernetes";
import { workflowRouter } from "../routers/workflow";
import { monitoringRouter } from "../routers/monitoring";
import { auditRouter } from "../routers/audit";
import { environmentRouter } from "../routers/environment";
import { domainRouter } from "../routers/domain";
import { webhookRouter } from "../routers/webhook";
import { notificationRouter } from "../routers/notification";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  organization: organizationRouter,
  project: projectRouter,
  application: applicationRouter,
  database: databaseRouter,
  deployment: deploymentRouter,
  user: userRouter,
  kubernetes: kubernetesRouter,
  workflow: workflowRouter,
  monitoring: monitoringRouter,
  audit: auditRouter,
  environment: environmentRouter,
  domain: domainRouter,
  webhook: webhookRouter,
  notification: notificationRouter,
});

export type AppRouter = typeof appRouter;