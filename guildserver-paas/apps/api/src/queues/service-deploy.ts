/**
 * Compose-stack deploy job.
 *
 * Stacks reuse the `deployment` queue rather than getting one of their own, so
 * that deployment history, live logs, concurrency limits and the rollback UI
 * all keep working without a second implementation of each. `deployments` has a
 * nullable `serviceId` for exactly this reason.
 */

import { eq } from "drizzle-orm";
import { db, deployments } from "@guildserver/database";
import { logger } from "../utils/logger";
import { broadcastToUser } from "../websocket/server";
import { deployStack } from "../services/compose/deploy";

export interface ServiceDeployJobData {
  deploymentId: string;
  serviceId: string;
  userId: string;
}

export async function runServiceDeployJob(data: ServiceDeployJobData): Promise<{ status: string }> {
  const { deploymentId, serviceId, userId } = data;

  await db.update(deployments).set({ status: "deploying" }).where(eq(deployments.id, deploymentId));
  broadcastToUser(userId, {
    type: "deployment_status",
    deploymentId,
    status: "deploying",
    message: "Preparing stack...",
  });

  try {
    const result = await deployStack({ serviceId, deploymentId, userId });

    const status = result.status === "running" ? "success" : "failed";
    await db
      .update(deployments)
      .set({
        status,
        deploymentLogs: result.logs.join("\n"),
        completedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));

    broadcastToUser(userId, {
      type: "deployment_status",
      deploymentId,
      status,
      message:
        result.status === "running"
          ? `Stack is running (${result.containers.length} container(s))`
          : `Stack is ${result.status}`,
    });

    return { status };
  } catch (error: any) {
    logger.error("Stack deployment failed", { serviceId, deploymentId, error: error?.message });
    await db
      .update(deployments)
      .set({
        status: "failed",
        deploymentLogs: error?.message || String(error),
        completedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));
    broadcastToUser(userId, {
      type: "deployment_status",
      deploymentId,
      status: "failed",
      message: error?.message || "Stack deployment failed",
    });
    throw error;
  }
}
