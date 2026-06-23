import "dotenv/config";
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";
import { logsRouter } from "./routes/logs";
import { Worker } from "bullmq";
import cron from "node-cron";
import {
  provisionProject, pauseProject, resumeProject, deleteProject, wakeProject,
} from "@guildserver/baas-scheduler";
import {
  createBackup, restoreBackup, restoreToPointInTime, sweepExpiredBackups,
} from "@guildserver/baas-scheduler";
import {
  reconcileNodes, reconcileProjects,
} from "@guildserver/baas-scheduler";
import {
  detectIdleProjects,
} from "@guildserver/baas-scheduler";
import {
  collectAllMetrics, pruneOldMetrics,
} from "@guildserver/baas-scheduler";
import { db, baasProjects, baasNodes } from "@guildserver/baas-db";
import { eq, inArray } from "drizzle-orm";
import { createProxyMiddleware } from "http-proxy-middleware";
import { jwtVerify } from "jose";

const PORT = parseInt(process.env.BAAS_API_PORT ?? "4001", 10);
const REDIS = { host: process.env.REDIS_HOST ?? "localhost", port: parseInt(process.env.REDIS_PORT ?? "6379") };

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: process.env.BAAS_WEB_URL ?? "http://localhost:3001", credentials: true }));
app.use(express.json());

// tRPC
app.use("/trpc", createExpressMiddleware({ router: appRouter, createContext }));

// Log streaming (REST/SSE — not tRPC)
app.use(logsRouter);

app.get("/health", (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Traefik HTTP provider — dynamic Studio subdomain routes ───────────────────
// Traefik polls this endpoint every 10s and registers a {slug}.baas.{domain}
// host-rule route pointing directly at the Studio container on each compute node.
const BASE_DOMAIN = process.env.BAAS_FALLBACK_DOMAIN ?? "baas.guildserver.com";

app.get("/traefik/config", async (_req, res) => {
  try {
    const projects = await db
      .select({
        slug:         baasProjects.slug,
        status:       baasProjects.status,
        hostPortBase: baasProjects.hostPortBase,
        externalIp:   baasNodes.externalIp,
        hostname:     baasNodes.hostname,
      })
      .from(baasProjects)
      .leftJoin(baasNodes, eq(baasNodes.id, baasProjects.nodeId))
      .where(inArray(baasProjects.status, ["active", "provisioning"]));

    const routers:  Record<string, object> = {};
    const services: Record<string, object> = {};

    for (const p of projects) {
      if (!p.hostPortBase || (!p.externalIp && !p.hostname)) continue;
      const studioPort = p.hostPortBase + 2;
      const host       = p.externalIp ?? p.hostname;
      const key        = `studio-${p.slug}`;

      routers[key] = {
        rule:        `Host(\`${p.slug}.baas.${BASE_DOMAIN}\`)`,
        service:     key,
        entryPoints: ["web", "websecure"],
        middlewares: ["strip-xframe"],
      };
      services[key] = {
        loadBalancer: { servers: [{ url: `http://${host}:${studioPort}` }] },
      };
    }

    const middlewares = {
      "strip-xframe": {
        headers: {
          customResponseHeaders: {
            "X-Frame-Options":              "",
            "Content-Security-Policy":      "frame-ancestors *",
          },
        },
      },
    };

    res.json({ http: { routers, services, middlewares } });
  } catch (e) {
    console.error("[traefik/config]", e);
    res.json({ http: { routers: {}, services: {}, middlewares: {} } });
  }
});

// ── Studio proxy — authenticated pass-through for in-app embed ────────────────
// GET /studio/:projectId  →  proxies the project's Studio container.
// Requires valid Bearer JWT; the proxy rewrites the request path.
app.use("/studio/:projectId", async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    await jwtVerify(auth.slice(7), secret);
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { projectId } = req.params as { projectId: string };
  const [project] = await db
    .select({ hostPortBase: baasProjects.hostPortBase, nodeId: baasProjects.nodeId })
    .from(baasProjects)
    .where(eq(baasProjects.id, projectId));

  if (!project?.nodeId || !project.hostPortBase) return res.status(404).json({ error: "Project not found or not provisioned" });

  const [node] = await db
    .select({ externalIp: baasNodes.externalIp, hostname: baasNodes.hostname })
    .from(baasNodes)
    .where(eq(baasNodes.id, project.nodeId));

  if (!node) return res.status(404).json({ error: "Node not found" });

  const host       = node.externalIp ?? node.hostname;
  const studioPort = project.hostPortBase + 2;

  createProxyMiddleware({
    target:      `http://${host}:${studioPort}`,
    changeOrigin: true,
    pathRewrite: { [`^/studio/${projectId}`]: "" },
    on: {
      proxyRes: (proxyRes) => {
        delete proxyRes.headers["x-frame-options"];
        proxyRes.headers["content-security-policy"] = "frame-ancestors *";
      },
    },
  })(req, res, next);
});

app.listen(PORT, () => console.log(`[baas-api] Listening on :${PORT}`));

// ── BullMQ Workers ────────────────────────────────────────────────────────────

new Worker("baas-provision", async (job) => {
  console.log(`[worker/provision] job=${job.name} id=${job.id}`);
  if (job.name === "provision") await provisionProject(job.data);
  if (job.name === "pause")     await pauseProject(job.data.projectId);
  if (job.name === "resume")    await resumeProject(job.data.projectId);
  if (job.name === "delete")    await deleteProject(job.data.projectId);
}, { connection: REDIS, concurrency: 3 });

new Worker("baas-backup", async (job) => {
  console.log(`[worker/backup] job=${job.name} id=${job.id}`);
  if (job.name === "create")       await createBackup(job.data.projectId, job.data.backupType);
  if (job.name === "restore")      await restoreBackup(job.data.backupId);
  if (job.name === "restore-pitr") await restoreToPointInTime(job.data.projectId, new Date(job.data.targetTime));
}, { connection: REDIS, concurrency: 2 });

// ── Cron jobs ─────────────────────────────────────────────────────────────────

// Node + project health — every 30s
cron.schedule("*/30 * * * * *", async () => {
  await Promise.allSettled([reconcileNodes(), reconcileProjects()]);
});

// Idle detector — every 5 minutes
cron.schedule("*/5 * * * *", () => detectIdleProjects().catch(console.error));

// Metrics collection — every 2 minutes
cron.schedule("*/2 * * * *", () => collectAllMetrics().catch(console.error));

// Nightly auto-backup at 03:00
cron.schedule("0 3 * * *", async () => {
  const projects = await db.select({ id: baasProjects.id })
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));

  for (const { id } of projects) {
    const [p] = await db.select({ backupEnabled: baasProjects.backupEnabled }).from(baasProjects).where(eq(baasProjects.id, id));
    if (p?.backupEnabled) {
      await createBackup(id, "automatic").catch((e) => console.error(`Backup failed for ${id}:`, e));
    }
  }
});

// Sweep expired backups at 04:00
cron.schedule("0 4 * * *", () => sweepExpiredBackups().catch(console.error));

// Prune old metrics at 04:30
cron.schedule("30 4 * * *", () => pruneOldMetrics().catch(console.error));

export type { AppRouter } from "./trpc/router";
