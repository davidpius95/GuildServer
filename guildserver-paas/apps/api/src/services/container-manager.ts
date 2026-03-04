import { db, applications, deployments } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import {
  listManagedContainers,
  getAppContainerInfo,
  getContainerStats,
  GS_LABELS,
  testDockerConnection,
  getDockerClient,
} from "./docker";
import Docker from "dockerode";

// Use the shared local Docker client from docker.ts instead of creating
// a separate instance. This keeps connection management in one place and
// allows container-manager functions to work with remote Docker clients
// when an explicit `dockerClient` is passed.
const getDefaultDocker = (): Docker => getDockerClient();

/**
 * Sync container status to database
 * Polls Docker for running containers and updates application statuses
 */
export async function syncContainerStatuses(dockerClient?: Docker): Promise<void> {
  const d = dockerClient || getDefaultDocker();
  try {
    const isConnected = await testDockerConnection(d);
    if (!isConnected) {
      logger.warn("Docker not available, skipping container sync");
      return;
    }

    // Get all managed containers
    const containers = await d.listContainers({
      all: true,
      filters: {
        label: [`${GS_LABELS.MANAGED}=true`, `${GS_LABELS.TYPE}=application`],
      },
    });

    // Build a map of applicationId -> container state
    const containerStates = new Map<string, string>();
    for (const c of containers) {
      const appId = c.Labels[GS_LABELS.APP_ID];
      if (appId) {
        containerStates.set(appId, c.State); // running, exited, paused, etc.
      }
    }

    // Update application statuses in DB
    for (const [appId, state] of containerStates) {
      const dbStatus = dockerStateToAppStatus(state);
      await db
        .update(applications)
        .set({ status: dbStatus, updatedAt: new Date() })
        .where(eq(applications.id, appId));
    }

    logger.debug(`Synced ${containerStates.size} container statuses`);
  } catch (error: any) {
    logger.error(`Container sync failed: ${error.message}`);
  }
}

/**
 * Map Docker container state to application status
 */
function dockerStateToAppStatus(dockerState: string): string {
  switch (dockerState) {
    case "running":
      return "running";
    case "exited":
    case "dead":
      return "stopped";
    case "paused":
      return "paused";
    case "restarting":
      return "restarting";
    case "created":
      return "deploying";
    default:
      return "unknown";
  }
}

/**
 * Collect metrics from all running containers and return them
 */
export async function collectAllMetrics(dockerClient?: Docker): Promise<
  Array<{
    applicationId: string;
    stats: {
      cpuPercent: number;
      memoryUsageMb: number;
      memoryLimitMb: number;
      memoryPercent: number;
      networkRxBytes: number;
      networkTxBytes: number;
    };
  }>
> {
  const d = dockerClient || getDefaultDocker();
  const results: Array<{
    applicationId: string;
    stats: {
      cpuPercent: number;
      memoryUsageMb: number;
      memoryLimitMb: number;
      memoryPercent: number;
      networkRxBytes: number;
      networkTxBytes: number;
    };
  }> = [];

  try {
    const containers = await d.listContainers({
      filters: {
        label: [`${GS_LABELS.MANAGED}=true`, `${GS_LABELS.TYPE}=application`],
        status: ["running"],
      },
    });

    for (const c of containers) {
      const appId = c.Labels[GS_LABELS.APP_ID];
      if (!appId) continue;

      const stats = await getContainerStats(appId, d);
      if (stats) {
        results.push({ applicationId: appId, stats });
      }
    }
  } catch (error: any) {
    logger.error(`Metrics collection failed: ${error.message}`);
  }

  return results;
}

/**
 * Health check: verify a container is responsive
 * Returns true if the container is running
 */
export async function healthCheck(
  applicationId: string,
  dockerClient?: Docker,
): Promise<{
  healthy: boolean;
  status: string;
  uptime?: number;
}> {
  const d = dockerClient || getDefaultDocker();
  try {
    const containers = await d.listContainers({
      all: true,
      filters: {
        label: [`${GS_LABELS.APP_ID}=${applicationId}`],
      },
    });

    if (containers.length === 0) {
      return { healthy: false, status: "not_found" };
    }

    const c = containers[0];
    const container = d.getContainer(c.Id);
    const inspection = await container.inspect();

    const isRunning = inspection.State.Running;
    const startedAt = new Date(inspection.State.StartedAt).getTime();
    const uptime = isRunning ? Date.now() - startedAt : 0;

    return {
      healthy: isRunning,
      status: inspection.State.Status,
      uptime: Math.floor(uptime / 1000), // seconds
    };
  } catch (error: any) {
    logger.warn(`Health check failed for app ${applicationId}: ${error.message}`);
    return { healthy: false, status: "error" };
  }
}

/**
 * Get a summary of all managed containers
 */
export async function getContainerSummary(dockerClient?: Docker): Promise<{
  total: number;
  running: number;
  stopped: number;
  errored: number;
}> {
  try {
    const containers = await listManagedContainers(dockerClient);

    return {
      total: containers.length,
      running: containers.filter((c) => c.status === "running").length,
      stopped: containers.filter((c) => c.status === "exited").length,
      errored: containers.filter((c) => c.status === "dead").length,
    };
  } catch {
    return { total: 0, running: 0, stopped: 0, errored: 0 };
  }
}
