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
import { githubRouter } from "../routers/github";
import { billingRouter } from "../routers/billing";
import { providerRouter } from "../routers/provider";
import { instanceRouter } from "../routers/instance";
import { infrastructureRouter } from "../routers/infrastructure";
import { securityRouter } from "../routers/security";
import { serviceRouter } from "../routers/service";
import { apiTokenRouter } from "../routers/api-token";
import { backupStorageRouter } from "../routers/backup-storage";
import { notificationChannelRouter } from "../routers/notification-channel";
import { logDrainRouter } from "../routers/log-drain";

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
  github: githubRouter,
  billing: billingRouter,
  provider: providerRouter,
  instance: instanceRouter,
  infrastructure: infrastructureRouter,
  security: securityRouter,
  /** Docker Compose stacks. */
  service: serviceRouter,
  /** Personal access tokens for the REST API. JWT-only, like every /trpc route. */
  apiToken: apiTokenRouter,
  /** Off-site (S3-compatible) destinations for database backups. */
  backupStorage: backupStorageRouter,
  notificationChannel: notificationChannelRouter,
  logDrain: logDrainRouter,
});

export type AppRouter = typeof appRouter;