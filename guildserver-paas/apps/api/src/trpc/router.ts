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
});

export type AppRouter = typeof appRouter;