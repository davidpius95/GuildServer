import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, applications, deployments, members, webhookDeliveries } from "@guildserver/database";
import { logger } from "../utils/logger";
import { deploymentQueue } from "../queues/setup";
import {
  verifyGithubWebhookSignature,
  verifyGitlabWebhookToken,
  parseGithubPushEvent,
  parseGitlabPushEvent,
} from "../services/git-provider";

export const webhookRouter = Router();

/**
 * GitHub Webhook Handler
 * POST /webhooks/github
 */
webhookRouter.post("/github", async (req: Request, res: Response) => {
  try {
    const event = req.headers["x-github-event"] as string;
    const signature = req.headers["x-hub-signature-256"] as string;

    logger.info("Received GitHub webhook", { event });

    // Verify signature if secret is configured
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      const rawBody = JSON.stringify(req.body);
      if (!verifyGithubWebhookSignature(rawBody, signature, webhookSecret)) {
        logger.warn("GitHub webhook signature verification failed");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    // Only handle push events
    if (event !== "push") {
      return res.json({ message: `Event ${event} acknowledged but not processed` });
    }

    const pushData = parseGithubPushEvent(req.body);
    if (!pushData) {
      return res.status(400).json({ error: "Invalid push event payload" });
    }

    logger.info("GitHub push event", {
      repository: pushData.repository,
      branch: pushData.branch,
      commit: pushData.commitSha.slice(0, 8),
    });

    // Find matching applications with auto-deployment enabled
    const matchingApps = await findMatchingApplications(
      pushData.repository,
      pushData.branch,
      "github"
    );

    if (matchingApps.length === 0) {
      logger.info("No matching applications found for webhook", {
        repository: pushData.repository,
        branch: pushData.branch,
      });
      return res.json({ message: "No matching applications", deploymentsTriggered: 0 });
    }

    // Trigger deployments for each matching application
    const triggered: string[] = [];
    const startTime = Date.now();
    for (const app of matchingApps) {
      const deploymentId = await triggerDeployment(app, pushData);
      if (deploymentId) triggered.push(deploymentId);

      // Log webhook delivery
      await logWebhookDelivery({
        applicationId: app.id,
        provider: "github",
        eventType: event,
        payload: { repository: pushData.repository, branch: pushData.branch, commitSha: pushData.commitSha, commitMessage: pushData.commitMessage },
        statusCode: 200,
        delivered: !!deploymentId,
        processingTimeMs: Date.now() - startTime,
        error: deploymentId ? null : "Failed to trigger deployment",
      });
    }

    logger.info(`Triggered ${triggered.length} deployments from GitHub webhook`);

    return res.json({
      message: `Triggered ${triggered.length} deployment(s)`,
      deploymentsTriggered: triggered.length,
      deploymentIds: triggered,
    });
  } catch (error: any) {
    logger.error("GitHub webhook error", { error: error.message });
    return res.status(500).json({ error: "Internal webhook processing error" });
  }
});

/**
 * GitLab Webhook Handler
 * POST /webhooks/gitlab
 */
webhookRouter.post("/gitlab", async (req: Request, res: Response) => {
  try {
    const event = req.headers["x-gitlab-event"] as string;
    const token = req.headers["x-gitlab-token"] as string;

    logger.info("Received GitLab webhook", { event });

    // Verify token if secret is configured
    const webhookSecret = process.env.GITLAB_WEBHOOK_SECRET;
    if (webhookSecret && token) {
      if (!verifyGitlabWebhookToken(token, webhookSecret)) {
        return res.status(401).json({ error: "Invalid token" });
      }
    }

    // Only handle push events
    if (event !== "Push Hook") {
      return res.json({ message: `Event ${event} acknowledged` });
    }

    const pushData = parseGitlabPushEvent(req.body);
    if (!pushData) {
      return res.status(400).json({ error: "Invalid push event payload" });
    }

    const matchingApps = await findMatchingApplications(
      pushData.repository,
      pushData.branch,
      "gitlab"
    );

    const triggered: string[] = [];
    const startTime = Date.now();
    for (const app of matchingApps) {
      const deploymentId = await triggerDeployment(app, pushData);
      if (deploymentId) triggered.push(deploymentId);

      await logWebhookDelivery({
        applicationId: app.id,
        provider: "gitlab",
        eventType: event || "Push Hook",
        payload: { repository: pushData.repository, branch: pushData.branch, commitSha: pushData.commitSha, commitMessage: pushData.commitMessage },
        statusCode: 200,
        delivered: !!deploymentId,
        processingTimeMs: Date.now() - startTime,
        error: deploymentId ? null : "Failed to trigger deployment",
      });
    }

    return res.json({
      message: `Triggered ${triggered.length} deployment(s)`,
      deploymentsTriggered: triggered.length,
      deploymentIds: triggered,
    });
  } catch (error: any) {
    logger.error("GitLab webhook error", { error: error.message });
    return res.status(500).json({ error: "Internal webhook processing error" });
  }
});

/**
 * Generic Git Webhook Handler (for Gitea, Bitbucket, or custom)
 * POST /webhooks/git
 */
webhookRouter.post("/git", async (req: Request, res: Response) => {
  try {
    const { repository, branch, commitSha, commitMessage, provider } = req.body;

    if (!repository || !branch) {
      return res.status(400).json({ error: "Missing repository or branch" });
    }

    logger.info("Received generic git webhook", { repository, branch, provider });

    const matchingApps = await findMatchingApplications(
      repository,
      branch,
      provider || "git"
    );

    const triggered: string[] = [];
    const startTime = Date.now();
    for (const app of matchingApps) {
      const deploymentId = await triggerDeployment(app, {
        repository,
        branch,
        commitSha: commitSha || "",
        commitMessage: commitMessage || "",
        commitAuthor: "",
        sender: "",
      });
      if (deploymentId) triggered.push(deploymentId);

      await logWebhookDelivery({
        applicationId: app.id,
        provider: provider || "git",
        eventType: "push",
        payload: { repository, branch, commitSha: commitSha || "", commitMessage: commitMessage || "" },
        statusCode: 200,
        delivered: !!deploymentId,
        processingTimeMs: Date.now() - startTime,
        error: deploymentId ? null : "Failed to trigger deployment",
      });
    }

    return res.json({
      message: `Triggered ${triggered.length} deployment(s)`,
      deploymentsTriggered: triggered.length,
      deploymentIds: triggered,
    });
  } catch (error: any) {
    logger.error("Generic webhook error", { error: error.message });
    return res.status(500).json({ error: "Internal webhook processing error" });
  }
});

/**
 * Find applications that match the given repository and branch
 * with autoDeployment enabled.
 * Returns apps with an `isPreviewDeploy` flag indicating whether
 * this push should trigger a preview deployment.
 */
async function findMatchingApplications(
  repository: string,
  branch: string,
  provider: string
): Promise<any[]> {
  // Query all applications and filter
  const allApps = await db.query.applications.findMany({
    with: {
      project: {
        with: {
          organization: true,
        },
      },
    },
  });

  return allApps
    .filter((app) => {
      if (!app.autoDeployment) return false;

      // Match source type
      if (app.sourceType !== provider && app.sourceType !== "git") return false;

      // Match repository (support both full URL and owner/repo format)
      const appRepo = (app.repository || "").toLowerCase();
      const webhookRepo = repository.toLowerCase();

      const repoMatch =
        appRepo === webhookRepo ||
        appRepo.includes(webhookRepo) ||
        webhookRepo.includes(appRepo) ||
        appRepo.endsWith(`/${webhookRepo}`) ||
        appRepo.endsWith(`/${webhookRepo}.git`);

      if (!repoMatch) return false;

      // Check if this is a preview deploy or a production deploy
      const mainBranch = app.mainBranch || app.branch || "main";
      const isMainBranch = branch === mainBranch;

      if (isMainBranch) {
        // Production deploy: branch must match the app's configured branch
        return true;
      } else if (app.previewDeployments) {
        // Preview deploy: non-main branch + preview deployments enabled
        return true;
      }

      // Non-main branch push but preview not enabled — skip
      return false;
    })
    .map((app) => {
      const mainBranch = app.mainBranch || app.branch || "main";
      const isPreviewDeploy = branch !== mainBranch && app.previewDeployments;
      return { ...app, isPreviewDeploy };
    });
}

/**
 * Trigger a deployment for an application from a webhook push event.
 * If `app.isPreviewDeploy` is true, creates a preview deployment
 * that doesn't replace the production container.
 */
async function triggerDeployment(
  app: any,
  pushData: {
    repository: string;
    branch: string;
    commitSha: string;
    commitMessage: string;
    commitAuthor: string;
    sender: string;
  }
): Promise<string | null> {
  try {
    const isPreview = app.isPreviewDeploy === true;

    // Find the org owner to use as the deployment user
    const orgOwner = await db.query.members.findFirst({
      where: eq(members.organizationId, app.project.organizationId),
    });

    const userId = orgOwner?.userId || app.project.organization.ownerId;

    // Create deployment record
    const [deployment] = await db
      .insert(deployments)
      .values({
        title: isPreview
          ? `Preview: ${pushData.branch} — ${pushData.commitMessage.slice(0, 40)}`
          : `Auto-deploy: ${pushData.commitMessage.slice(0, 50)}`,
        description: `Triggered by push from ${pushData.sender} to ${pushData.branch}`,
        status: "pending",
        applicationId: app.id,
        gitCommitSha: pushData.commitSha,
        deploymentType: isPreview ? "preview" : "standard",
        triggeredBy: `webhook:${pushData.sender || "github"}`,
        isPreview,
        previewBranch: isPreview ? pushData.branch : null,
        startedAt: new Date(),
      })
      .returning();

    // Add to deployment queue
    await deploymentQueue.add(
      "deploy-application",
      {
        deploymentId: deployment.id,
        applicationId: app.id,
        userId,
        isPreview,
        previewBranch: isPreview ? pushData.branch : undefined,
      },
      {
        removeOnComplete: 50,
        removeOnFail: 20,
      }
    );

    logger.info(`${isPreview ? "Preview" : "Auto"}-deployment triggered for ${app.appName}`, {
      deploymentId: deployment.id,
      branch: pushData.branch,
      commitSha: pushData.commitSha.slice(0, 8),
      isPreview,
    });

    return deployment.id;
  } catch (error: any) {
    logger.error(`Failed to trigger deployment for ${app.appName}`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Log a webhook delivery for tracking and debugging
 */
async function logWebhookDelivery(data: {
  applicationId: string;
  provider: string;
  eventType: string;
  payload: any;
  statusCode: number;
  delivered: boolean;
  processingTimeMs: number;
  error: string | null;
}) {
  try {
    await db.insert(webhookDeliveries).values({
      applicationId: data.applicationId,
      provider: data.provider,
      eventType: data.eventType,
      payload: data.payload,
      statusCode: data.statusCode,
      delivered: data.delivered,
      processingTimeMs: data.processingTimeMs,
      error: data.error,
    });
  } catch (err: any) {
    logger.warn("Failed to log webhook delivery", { error: err.message });
  }
}
