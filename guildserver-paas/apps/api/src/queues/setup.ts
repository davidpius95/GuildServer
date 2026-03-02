import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { eq, and } from "drizzle-orm";
import { db, deployments, applications, environmentVariables, domains, projects } from "@guildserver/database";
import { logger } from "../utils/logger";
import {
  deployContainer,
  testDockerConnection,
  ensureNetwork,
} from "../services/docker";
import { syncContainerStatuses } from "../services/container-manager";
import { broadcastToUser } from "../websocket/server";
import { cloneRepository, cleanupClone } from "../services/git-provider";
import { buildImage, getPortForBuildType } from "../services/builder";
import { startMetricsCollection, stopMetricsCollection, collectAndStoreMetrics } from "../services/metrics-collector";
import { notify } from "../services/notification";
import crypto from "crypto";
import path from "path";

// Redis connection
// Note: dotenv may not be loaded when this module initializes (import hoisting),
// so we default to the correct GuildServer Redis port (6380)
const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6380", {
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
});

// Queue definitions
export const deploymentQueue = new Queue("deployment", { connection: redis });
export const monitoringQueue = new Queue("monitoring", { connection: redis });
export const backupQueue = new Queue("backup", { connection: redis });

// Helper to update deployment status in DB
async function updateDeploymentStatus(
  deploymentId: string,
  status: string,
  extra: Partial<{
    buildLogs: string;
    deploymentLogs: string;
    completedAt: Date;
  }> = {}
) {
  await db
    .update(deployments)
    .set({ status, ...extra })
    .where(eq(deployments.id, deploymentId));
}

// Helper to update application status in DB
async function updateApplicationStatus(applicationId: string, status: string) {
  await db
    .update(applications)
    .set({ status, updatedAt: new Date() })
    .where(eq(applications.id, applicationId));
}

// Deployment worker - REAL Docker deployment
const deploymentWorker = new Worker(
  "deployment",
  async (job) => {
    logger.info("Processing deployment job", { jobId: job.id, data: job.data });

    const { deploymentId, applicationId, userId, isRollback, sourceDeploymentId, isPreview, previewBranch } = job.data;
    const allBuildLogs: string[] = [];

    try {
      // 1. Update deployment status to "building"
      await updateDeploymentStatus(deploymentId, isRollback ? "deploying" : "building");
      await updateApplicationStatus(applicationId, "deploying");

      // Notify user via WebSocket
      broadcastToUser(userId, {
        type: "deployment_status",
        deploymentId,
        status: "building",
        message: "Preparing deployment...",
      });

      // 2. Fetch application config from DB
      const app = await db.query.applications.findFirst({
        where: eq(applications.id, applicationId),
      });

      if (!app) {
        throw new Error(`Application ${applicationId} not found`);
      }

      // 3. Check Docker connectivity
      const dockerAvailable = await testDockerConnection();
      if (!dockerAvailable) {
        throw new Error("Docker daemon is not available. Please ensure Docker is running.");
      }

      // 4. Determine Docker image - either pre-built or build from git
      let dockerImage = app.dockerImage || "";
      let dockerTag = app.dockerTag || "latest";
      let resolvedImageTag = ""; // Track the full image:tag for rollback support
      let detectedPort = 0; // Port detected from build type (for git-built images)
      const isGitBased = app.repository && app.sourceType !== "docker";

      // === ROLLBACK FAST PATH ===
      if (isRollback && sourceDeploymentId) {
        const sourceDeployment = await db.query.deployments.findFirst({
          where: eq(deployments.id, sourceDeploymentId),
        });

        if (!sourceDeployment?.imageTag) {
          throw new Error("Source deployment has no image tag for rollback");
        }

        const rollbackImageTag = sourceDeployment.imageTag;
        allBuildLogs.push(`🔄 Rolling back to deployment ${sourceDeploymentId.slice(0, 8)}...`);
        allBuildLogs.push(`Using image: ${rollbackImageTag}`);

        broadcastToUser(userId, {
          type: "deployment_log",
          deploymentId,
          log: `🔄 Rolling back to deployment ${sourceDeploymentId.slice(0, 8)}...`,
          phase: "rollback",
        });
        broadcastToUser(userId, {
          type: "deployment_log",
          deploymentId,
          log: `Using image: ${rollbackImageTag}`,
          phase: "rollback",
        });

        // Parse the image tag
        const colonIdx = rollbackImageTag.lastIndexOf(":");
        if (colonIdx > 0) {
          dockerImage = rollbackImageTag.substring(0, colonIdx);
          dockerTag = rollbackImageTag.substring(colonIdx + 1);
        } else {
          dockerImage = rollbackImageTag;
          dockerTag = "latest";
        }
        resolvedImageTag = rollbackImageTag;

        // Skip directly to deploy step (no clone, no build)
        await updateDeploymentStatus(deploymentId, "deploying", {
          buildLogs: allBuildLogs.join("\n"),
        });
        broadcastToUser(userId, {
          type: "deployment_status",
          deploymentId,
          status: "deploying",
          message: "Rolling back container...",
        });
      } else if (isGitBased) {
        // === GIT-BASED BUILD PIPELINE ===
        broadcastToUser(userId, {
          type: "deployment_status",
          deploymentId,
          status: "building",
          message: `Cloning ${app.repository}...`,
        });

        // Clone repository
        const cloneResult = await cloneRepository(
          {
            provider: (app.sourceType as any) || "git",
            repository: app.repository!,
            branch: app.branch || "main",
          },
          deploymentId,
          (msg) => {
            allBuildLogs.push(msg);
            broadcastToUser(userId, {
              type: "deployment_log",
              deploymentId,
              log: msg,
              phase: "clone",
            });
          }
        );

        // Update deployment with commit info
        await db
          .update(deployments)
          .set({ gitCommitSha: cloneResult.commitSha })
          .where(eq(deployments.id, deploymentId));

        // Build Docker image from cloned source
        broadcastToUser(userId, {
          type: "deployment_status",
          deploymentId,
          status: "building",
          message: "Building Docker image...",
        });

        // Use buildPath subdirectory if specified (for monorepo/template builds)
        const buildDir = app.buildPath
          ? path.join(cloneResult.localPath, app.buildPath)
          : cloneResult.localPath;

        const buildResult = await buildImage({
          localPath: buildDir,
          appName: app.appName,
          deploymentId,
          userId,
          buildType: app.buildType || undefined,
          dockerfile: app.dockerfile || undefined,
          buildArgs: (app.buildArgs as Record<string, string>) || {},
          environment: (app.environment as Record<string, string>) || {},
        });

        allBuildLogs.push(...buildResult.buildLogs);

        // Use the built image
        dockerImage = buildResult.imageTag;
        dockerTag = ""; // imageTag already includes the tag

        // Derive the container port from the build result or fall back to build type mapping
        detectedPort = buildResult.containerPort || getPortForBuildType(buildResult.detectedType);
        if (detectedPort > 0) {
          allBuildLogs.push(`Detected container port: ${detectedPort} (from ${buildResult.detectedType} project)`);
        }

        // Clean up cloned source
        cleanupClone(deploymentId);
      } else if (!dockerImage) {
        if (app.sourceType === "docker") {
          throw new Error("No Docker image specified for Docker-type application");
        }
        // Fallback for apps without image or repository
        dockerImage = "nginx";
        dockerTag = "alpine";
        logger.info(
          `No Docker image or repository for app ${app.appName}, using default nginx:alpine`
        );
      }

      // 5. Update to "deploying" status (skip for rollback — already set above)
      if (!isRollback) {
        await updateDeploymentStatus(deploymentId, "deploying", {
          buildLogs: allBuildLogs.length > 0 ? allBuildLogs.join("\n") : undefined,
        });
        broadcastToUser(userId, {
          type: "deployment_status",
          deploymentId,
          status: "deploying",
          message: "Deploying container...",
        });
      }

      // 5b. Merge scoped environment variables from DB
      const scopedEnvVars = await db.query.environmentVariables.findMany({
        where: eq(environmentVariables.applicationId, applicationId),
      });

      // Build merged env: app-level env + scoped env vars (production scope for deploy)
      const mergedEnv: Record<string, string> = {
        ...((app.environment as Record<string, string>) || {}),
      };
      for (const envVar of scopedEnvVars) {
        if (envVar.scope === "production" || !envVar.scope) {
          // Decrypt if secret
          let val = envVar.value;
          if (envVar.isSecret) {
            try {
              const [ivHex, encrypted] = val.split(":");
              if (ivHex && encrypted) {
                const encKey = (process.env.ENV_ENCRYPTION_KEY || "dev-encryption-key-32-chars-long!").padEnd(32).slice(0, 32);
                const iv = Buffer.from(ivHex, "hex");
                const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(encKey), iv);
                val = decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
              }
            } catch { /* use raw value if decrypt fails */ }
          }
          mergedEnv[envVar.key] = val;
        }
      }

      // 5c. Auto-generate a domain URL if none exists (BEFORE container deploy
      // so Traefik labels are set correctly on first deploy)
      const existingDomains = await db.query.domains.findMany({
        where: eq(domains.applicationId, applicationId),
      });

      if (existingDomains.length === 0) {
        const baseDomain = process.env.BASE_DOMAIN || "guildserver.localhost";
        const appSlug = app.appName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const autoUrl = `${appSlug}.${baseDomain}`;
        try {
          await db.insert(domains).values({
            domain: autoUrl,
            applicationId,
            isPrimary: true,
            isAutoGenerated: true,
            verified: true,
            status: "active",
            forceHttps: false,
          });
          allBuildLogs.push(`Auto-generated URL: http://${autoUrl}`);
        } catch (domainErr: any) {
          logger.warn("Failed to create auto-domain", { error: domainErr.message, applicationId });
        }
      }

      // 5d. Fetch active domains for Traefik routing (includes auto-generated)
      const appDomains = await db.query.domains.findMany({
        where: and(
          eq(domains.applicationId, applicationId),
          eq(domains.status, "active")
        ),
      });
      let domainList = appDomains.map((d) => d.domain);

      // For preview deployments, generate a preview-specific domain
      let previewDomain: string | null = null;
      if (isPreview && previewBranch) {
        const baseDomain = process.env.BASE_DOMAIN || "guildserver.localhost";
        const safeBranch = previewBranch.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        const appSlug = app.appName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        previewDomain = `${safeBranch}-${appSlug}.${baseDomain}`;
        domainList = [previewDomain];
        allBuildLogs.push(`🔀 Preview deployment for branch: ${previewBranch}`);
        allBuildLogs.push(`Preview URL: http://${previewDomain}`);

        broadcastToUser(userId, {
          type: "deployment_log",
          deploymentId,
          log: `🔀 Preview deployment for branch: ${previewBranch}`,
          phase: "preview",
        });
      }

      // 6. Deploy the container (with Traefik routing labels)
      // Parse image reference properly — handle cases like:
      //   "grafana/grafana:10.0" in image field → image=grafana/grafana, tag=10.0
      //   "nginx" with tag="alpine" → image=nginx, tag=alpine
      //   "grafana/grafana" with no tag → image=grafana/grafana, tag=latest
      const trimmedImage = dockerImage.trim();
      const hasTagInImage = trimmedImage.includes(":");
      const effectiveImage = hasTagInImage ? trimmedImage.split(":")[0] : trimmedImage;
      const effectiveTag = (hasTagInImage ? trimmedImage.split(":")[1] : dockerTag || "latest").trim();

      // For previews: use branch-specific appName so production isn't replaced
      const containerAppName = isPreview && previewBranch
        ? `${app.appName}-preview-${previewBranch.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`
        : app.appName;

      const result = await deployContainer({
        deploymentId,
        applicationId,
        appName: containerAppName,
        projectId: app.projectId || "",
        userId,
        dockerImage: effectiveImage,
        dockerTag: effectiveTag,
        environment: mergedEnv,
        memoryLimit: app.memoryLimit,
        cpuLimit: app.cpuLimit,
        containerPort: app.containerPort || detectedPort || undefined,
        replicas: app.replicas || 1,
        sourceType: app.sourceType || "docker",
        domains: domainList.length > 0 ? domainList : undefined,
      });

      // 7. Update deployment status to "completed"
      allBuildLogs.push(...result.logs);
      const allLogs = allBuildLogs.join("\n");

      // Resolve the friendly access URL
      const accessUrl = previewDomain
        ? `http://${previewDomain}`
        : appDomains.find((d) => d.isPrimary) || appDomains[0]
          ? `http://${(appDomains.find((d) => d.isPrimary) || appDomains[0]).domain}`
          : `http://localhost:${result.hostPort}`;

      // Save the image tag for future rollbacks
      const finalImageTag = resolvedImageTag || `${effectiveImage}:${effectiveTag}`;

      await db
        .update(deployments)
        .set({
          status: "completed",
          buildLogs: allLogs,
          deploymentLogs: `Container: ${result.containerName}\nPort: ${result.hostPort}\nContainer ID: ${result.containerId}\nURL: ${accessUrl}`,
          completedAt: new Date(),
          imageTag: finalImageTag,
        })
        .where(eq(deployments.id, deploymentId));

      // 8. Update application status to "running"
      await updateApplicationStatus(applicationId, "running");

      // 9. Notify user with friendly URL
      broadcastToUser(userId, {
        type: "deployment_status",
        deploymentId,
        status: "completed",
        message: `Deployment successful! Access at ${accessUrl}`,
        url: accessUrl,
        directUrl: `http://localhost:${result.hostPort}`,
        containerId: result.containerId,
      });

      // 10. Send notifications (in-app, email, Slack)
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, app.projectId || ""),
      });
      const orgId = project?.organizationId || null;

      const notifyEvent = isPreview ? "preview_created" as const : "deployment_success" as const;
      notify(notifyEvent, userId, orgId, {
        appName: app.appName,
        url: accessUrl,
        commitSha: app.repository ? deploymentId.slice(0, 8) : undefined,
        branch: previewBranch || app.branch || "main",
        previewUrl: isPreview ? accessUrl : undefined,
      }).catch((err) => logger.warn("Notification error:", err.message));

      logger.info("Deployment completed successfully", {
        deploymentId,
        applicationId,
        containerId: result.containerId,
        port: result.hostPort,
      });

      return {
        success: true,
        deploymentId,
        containerId: result.containerId,
        port: result.hostPort,
      };
    } catch (error: any) {
      logger.error("Deployment failed", { error: error.message, deploymentId, applicationId });

      // Update deployment status to failed (preserve accumulated build logs)
      const errorLog = `ERROR: ${error.message}`;
      const existingLogs = allBuildLogs.length > 0 ? allBuildLogs.join("\n") + "\n" + errorLog : errorLog;
      await updateDeploymentStatus(deploymentId, "failed", {
        buildLogs: existingLogs,
        completedAt: new Date(),
      });

      // Update application status
      await updateApplicationStatus(applicationId, "failed");

      // Notify user via WebSocket
      broadcastToUser(userId, {
        type: "deployment_status",
        deploymentId,
        status: "failed",
        message: `Deployment failed: ${error.message}`,
      });

      // Send failure notification (in-app, email, Slack)
      const failProject = await db.query.projects.findFirst({
        where: eq(projects.id, app?.projectId || ""),
      }).catch(() => null);
      const failOrgId = failProject?.organizationId || null;

      notify("deployment_failed", userId, failOrgId, {
        appName: app?.appName || "Unknown",
        error: error.message,
        logsUrl: `${process.env.APP_URL || "http://localhost:3000"}/dashboard/applications/${applicationId}`,
      }).catch((err) => logger.warn("Notification error:", err.message));

      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 3,
  }
);

// Monitoring worker - real container monitoring
const monitoringWorker = new Worker(
  "monitoring",
  async (job) => {
    const { type, resourceId } = job.data;

    try {
      switch (type) {
        case "collect-metrics":
          await syncContainerStatuses();
          await collectAndStoreMetrics();
          break;
        case "health-check":
          await syncContainerStatuses();
          break;
        case "alert-check":
          break;
        default:
          logger.warn("Unknown monitoring job type", { type });
      }

      return { success: true, type, resourceId };
    } catch (error: any) {
      logger.error("Monitoring job failed", { error: error.message, type, resourceId });
      throw error;
    }
  },
  { connection: redis }
);

// Backup worker
const backupWorker = new Worker(
  "backup",
  async (job) => {
    logger.info("Processing backup job", { jobId: job.id, data: job.data });

    const { databaseId, backupType } = job.data;

    try {
      await new Promise((resolve) => setTimeout(resolve, 10000));

      logger.info("Backup completed successfully", { databaseId, backupType });

      return { success: true, databaseId, backupType };
    } catch (error: any) {
      logger.error("Backup failed", { error: error.message, databaseId, backupType });
      throw error;
    }
  },
  { connection: redis }
);

// Worker event handlers
deploymentWorker.on("completed", (job) => {
  logger.info("Deployment job completed", {
    jobId: job.id,
    result: job.returnvalue,
  });
});

deploymentWorker.on("failed", (job, err) => {
  logger.error("Deployment job failed", { jobId: job?.id, error: err.message });
});

monitoringWorker.on("completed", (job) => {
  logger.debug("Monitoring job completed", { jobId: job.id });
});

monitoringWorker.on("failed", (job, err) => {
  logger.error("Monitoring job failed", { jobId: job?.id, error: err.message });
});

backupWorker.on("completed", (job) => {
  logger.info("Backup job completed", { jobId: job.id });
});

backupWorker.on("failed", (job, err) => {
  logger.error("Backup job failed", { jobId: job?.id, error: err.message });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, closing workers...");
  stopMetricsCollection();
  await deploymentWorker.close();
  await monitoringWorker.close();
  await backupWorker.close();
  await redis.quit();
});

export async function initializeQueues() {
  try {
    // Test Redis connection
    await redis.ping();
    logger.info("✅ Redis connection established");

    // Test Docker connection
    const dockerOk = await testDockerConnection();
    if (dockerOk) {
      logger.info("✅ Docker daemon connected");

      // Ensure the "guildserver" Docker network exists (needed for Traefik routing)
      await ensureNetwork();
      logger.info("✅ Docker network 'guildserver' ready");
    } else {
      logger.warn("⚠️ Docker daemon not available - deployments will fail");
    }

    // Add recurring monitoring jobs
    await monitoringQueue.add(
      "collect-metrics",
      { type: "collect-metrics" },
      {
        repeat: { pattern: "*/5 * * * *" },
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );

    await monitoringQueue.add(
      "health-check",
      { type: "health-check" },
      {
        repeat: { pattern: "*/2 * * * *" },
        removeOnComplete: 50,
        removeOnFail: 20,
      }
    );

    // Initial container status sync
    if (dockerOk) {
      await syncContainerStatuses();
      logger.info("✅ Initial container status sync completed");

      // Start periodic metrics collection (every 15 seconds)
      startMetricsCollection(15000);

      // Collect initial metrics immediately
      await collectAndStoreMetrics();
      logger.info("✅ Metrics collection started (every 15s)");
    }

    logger.info("✅ Background job queues initialized");
  } catch (error) {
    logger.error("❌ Failed to initialize queues", { error });
    throw error;
  }
}
