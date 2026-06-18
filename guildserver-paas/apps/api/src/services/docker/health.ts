import http from "http";
import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { broadcastToUser } from "../../websocket/server";
import { docker } from "./client";

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  portMismatch?: { expected: number; actual: number };
}

function probeHttp(port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port, path: "/", timeout: timeoutMs },
      (res) => { res.resume(); resolve(true); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function detectActualListeningPort(containerId: string, dockerClient?: Docker): Promise<number | null> {
  const d = dockerClient || docker;
  try {
    const container = d.getContainer(containerId);
    const inspection = await container.inspect();
    const portBindings = inspection.NetworkSettings?.Ports || {};

    for (const [containerPort] of Object.entries(portBindings)) {
      const parsed = parseInt(containerPort, 10);
      if (!isNaN(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function postDeployHealthCheck(opts: {
  containerId: string;
  hostPort: number;
  expectedContainerPort: number;
  userId?: string;
  deploymentId?: string;
  maxWaitMs?: number;
  dockerClient?: Docker;
}): Promise<HealthCheckResult> {
  const { containerId, hostPort, expectedContainerPort, userId, deploymentId, maxWaitMs = 30000, dockerClient } = opts;

  const log = (msg: string) => {
    logger.info(`[healthcheck] ${msg}`);
    if (userId && deploymentId) {
      broadcastToUser(userId, { type: "deployment_log", deploymentId, log: msg, phase: "health_check" });
    }
  };

  const intervalMs = 2000;
  const maxAttempts = Math.ceil(maxWaitMs / intervalMs);

  log(`Running health check on port ${hostPort} (expecting container port ${expectedContainerPort})...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const reachable = await probeHttp(hostPort);
    if (reachable) {
      log(`✅ Service is responding on port ${hostPort} (attempt ${attempt}/${maxAttempts})`);
      return { healthy: true, message: "Service is responding" };
    }

    if (attempt < maxAttempts) {
      log(`⏳ Waiting for service to start (attempt ${attempt}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  log("⚠️ Service did not respond within the timeout window. Diagnosing...");

  const d = dockerClient || docker;
  try {
    const container = d.getContainer(containerId);
    const inspection = await container.inspect();

    if (!inspection.State.Running) {
      const exitCode = inspection.State.ExitCode;
      log(`❌ Container exited with code ${exitCode}. Check the build logs for errors.`);
      return {
        healthy: false,
        message: `Container crashed (exit code ${exitCode}). The application failed to start — check build logs.`,
      };
    }
  } catch {
    // container may have been removed
  }

  const actualPort = await detectActualListeningPort(containerId, dockerClient);
  if (actualPort && actualPort !== expectedContainerPort) {
    log(
      `❌ Port mismatch detected! Expected container port ${expectedContainerPort} ` +
      `but the image exposes port ${actualPort}.`,
    );
    return {
      healthy: false,
      message:
        `Port mismatch: Traefik is routing to container port ${expectedContainerPort} ` +
        `but the container is actually listening on port ${actualPort}. ` +
        `Try setting the correct port in the application settings.`,
      portMismatch: { expected: expectedContainerPort, actual: actualPort },
    };
  }

  log(`❌ Service did not respond on port ${hostPort} after ${maxWaitMs / 1000}s.`);
  return {
    healthy: false,
    message:
      `Service unreachable after ${maxWaitMs / 1000}s. ` +
      `The container is running but the application is not responding on port ${expectedContainerPort}. ` +
      `Check the application logs for startup errors.`,
  };
}
