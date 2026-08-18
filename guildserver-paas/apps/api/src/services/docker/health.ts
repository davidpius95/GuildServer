import http from "http";
import net from "net";
import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { broadcastToUser } from "../../websocket/server";
import { docker } from "./client";

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  portMismatch?: { expected: number; actual: number };
}

function probeHttp(hostname: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname, port, path: "/", timeout: timeoutMs },
      (res) => { res.resume(); resolve(true); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/**
 * Raw TCP connect, no protocol assumed.
 *
 * probeHttp alone marks non-HTTP services (Redis, Postgres, MySQL, RabbitMQ,
 * any raw TCP protocol) permanently unhealthy: it sends an HTTP request over
 * the connection, the peer doesn't speak HTTP, and the client errors out —
 * indistinguishable from "nothing is listening yet". A container that was
 * verified running via `docker logs` and accepting real client connections
 * was still failing this check every time.
 *
 * Used as the confirming signal for non-HTTP services: if the TCP handshake
 * itself succeeds, on this port specifically, something real is listening.
 */
function probeTcp(hostname: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.connect(port, hostname);
  });
}

async function getContainerIPAddress(containerId: string, dockerClient?: Docker): Promise<string | null> {
  const d = dockerClient || docker;
  try {
    const container = d.getContainer(containerId);
    const inspection = await container.inspect();
    const networks = inspection.NetworkSettings?.Networks || {};

    for (const network of Object.values(networks)) {
      if (network?.IPAddress) return network.IPAddress;
    }
  } catch {
    // ignore
  }
  return null;
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
  const { containerId, hostPort, expectedContainerPort, userId, deploymentId, maxWaitMs = 120000, dockerClient } = opts;

  const log = (msg: string) => {
    logger.info(`[healthcheck] ${msg}`);
    if (userId && deploymentId) {
      broadcastToUser(userId, { type: "deployment_log", deploymentId, log: msg, phase: "health_check" });
    }
  };

  const intervalMs = 2000;
  const maxAttempts = Math.ceil(maxWaitMs / intervalMs);
  const containerIP = await getContainerIPAddress(containerId, dockerClient);

  log(`Running health check on port ${hostPort} (expecting container port ${expectedContainerPort})...`);

  // Consecutive TCP-reachable attempts while HTTP never once responds — the
  // confirming signal that this is a real, running non-HTTP service rather
  // than a container that just hasn't started yet (which fails BOTH probes).
  let consecutiveTcpOnly = 0;
  const TCP_CONFIRM_THRESHOLD = 3; // ~6s of stable TCP reachability

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const host = containerIP || "127.0.0.1";
    const port = containerIP ? expectedContainerPort : hostPort;
    const target = `${host}:${port}`;

    const httpReachable = await probeHttp(host, port);

    if (httpReachable) {
      log(`✅ Service is responding on ${target} (attempt ${attempt}/${maxAttempts})`);
      return { healthy: true, message: "Service is responding" };
    }

    const tcpReachable = await probeTcp(host, port);
    if (tcpReachable) {
      consecutiveTcpOnly++;
      if (consecutiveTcpOnly >= TCP_CONFIRM_THRESHOLD) {
        log(
          `✅ Port ${target} has accepted TCP connections for ${consecutiveTcpOnly} consecutive checks ` +
          `without ever responding to HTTP — treating as a healthy non-HTTP service (attempt ${attempt}/${maxAttempts}).`,
        );
        return {
          healthy: true,
          message: "Port is open and accepting connections (non-HTTP service — no HTTP response expected)",
        };
      }
    } else {
      consecutiveTcpOnly = 0; // nothing listening yet; reset the streak
    }

    const actualPort = await detectActualListeningPort(containerId, dockerClient);
    if (actualPort && actualPort !== expectedContainerPort) {
      log(
        `❌ Port mismatch detected early! Expected container port ${expectedContainerPort} ` +
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
