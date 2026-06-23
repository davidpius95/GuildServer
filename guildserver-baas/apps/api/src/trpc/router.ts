import { router } from "./trpc";
import { authRouter }        from "../routers/auth";
import { baasProjectRouter } from "../routers/baas-project";
import { baasBackupRouter }  from "../routers/baas-backup";
import { baasDomainRouter }  from "../routers/baas-domain";
import { baasNodeRouter }    from "../routers/baas-node";
import { baasMetricsRouter } from "../routers/baas-metrics";

export const appRouter = router({
  auth:        authRouter,
  baasProject: baasProjectRouter,
  baasBackup:  baasBackupRouter,
  baasDomain:  baasDomainRouter,
  baasNode:    baasNodeRouter,
  baasMetrics: baasMetricsRouter,
});

export type AppRouter = typeof appRouter;
