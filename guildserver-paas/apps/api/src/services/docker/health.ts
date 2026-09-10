import http from "http";
import net from "net";
import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { broadcastToUser } from "../../websocket/server";
import { docker } from "./client";
import type { HealthCheckConfig } from "./deploy-config";

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  portMismatch?: { expected: number; actual: number };
  /** How the service was verified. Absent on failure — no protocol was confirmed. */
  protocol?: "http" | "tcp";
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
      return { healthy: true, message: "Service is responding", protocol: "http" };
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
          protocol: "tcp",
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

// ---------------------------------------------------------------------------
// Configurable, per-application health checks
// ---------------------------------------------------------------------------

/**
 * Single HTTP request returning the status code, or null if the request never
 * produced a response (connection refused, reset, or timed out).
 */
function probeHttpStatus(
  hostname: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    const req = http.get({ hostname, port, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ?? null);
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Poll an application's configured health endpoint until it answers with an
 * accepted status, or until `retries` consecutive failures have accumulated.
 *
 * Semantics deliberately mirror docker-compose's `healthcheck:` block, because
 * that is the mental model operators already have:
 *   - nothing is judged during `start_period`;
 *   - after it, poll every `interval`, each request capped at `timeout`;
 *   - `retries` consecutive failures means unhealthy.
 *
 * A container that exits is failed immediately rather than waited out — there is
 * nothing left to become healthy.
 */
export async function runConfiguredHealthCheck(opts: {
  containerId: string;
  hostPort: number;
  /** Port the service listens on inside the container; used when config.port is unset. */
  expectedContainerPort: number;
  config: HealthCheckConfig;
  userId?: string;
  deploymentId?: string;
  dockerClient?: Docker;
  /** Overall ceiling, independent of `retries`. */
  maxWaitMs?: number;
}): Promise<HealthCheckResult> {
  const { containerId, hostPort, expectedContainerPort, config, userId, deploymentId, dockerClient } = opts;
  const d = dockerClient || docker;

  const log = (msg: string) => {
    logger.info(`[healthcheck] ${msg}`);
    if (userId && deploymentId) {
      broadcastToUser(userId, { type: "deployment_log", deploymentId, log: msg, phase: "health_check" });
    }
  };

  const containerIP = await getContainerIPAddress(containerId, d);
  const host = containerIP || "127.0.0.1";
  const port = containerIP ? config.port || expectedContainerPort : hostPort;
  const target = `${host}:${port}${config.path}`;

  log(
    `Health check: GET ${target} every ${config.intervalSeconds}s ` +
      `(timeout ${config.timeoutSeconds}s, ${config.retries} retries, ` +
      `start period ${config.startPeriodSeconds}s, accept ${config.expectedStatus})`,
  );

  if (config.startPeriodSeconds > 0) {
    await new Promise((r) => setTimeout(r, config.startPeriodSeconds * 1000));
  }

  const deadline = Date.now() + (opts.maxWaitMs ?? 120000);
  let attempts = 0;
  let lastStatus: number | null = null;

  // `retries` counts tolerated failures, so the number of attempts is retries + 1.
  for (let attempt = 1; attempt <= config.retries + 1; attempt++) {
    const status = await probeHttpStatus(host, port, config.path, config.timeoutSeconds * 1000);
    lastStatus = status;
    attempts = attempt;

    if (status !== null && config.matchesStatus(status)) {
      log(`✅ ${target} returned ${status}, accepted by "${config.expectedStatus}" (attempt ${attempt})`);
      return {
        healthy: true,
        message: `Health check passed (HTTP ${status} on ${config.path})`,
        protocol: "http",
      };
    }

    const detail = status === null ? "no response" : `HTTP ${status}`;
    log(`⏳ ${target} → ${detail} (attempt ${attempt}/${config.retries + 1})`);

    // A container that has exited will never recover; stop burning the window.
    try {
      const inspection = await d.getContainer(containerId).inspect();
      if (!inspection.State.Running) {
        return {
          healthy: false,
          message: `Container exited during health check (exit code ${inspection.State.ExitCode}).`,
        };
      }
    } catch {
      return { healthy: false, message: "Container disappeared during health check." };
    }

    if (Date.now() >= deadline) break;
    if (attempt <= config.retries) {
      await new Promise((r) => setTimeout(r, config.intervalSeconds * 1000));
    }
  }

  const detail = lastStatus === null ? "never responded" : `last responded with HTTP ${lastStatus}`;
  return {
    healthy: false,
    message:
      `Health check failed: GET ${config.path} on port ${port} ${detail}, ` +
      `expected ${config.expectedStatus} (after ${attempts} attempts).`,
  };
}

/**
 * Health-gate entry point.
 *
 * `config: null` — i.e. `health_check_path` is NULL, which is every application
 * row that predates the health-check columns — falls through to the existing
 * reachability probe with identical arguments, so legacy behaviour is preserved
 * exactly.
 */
export async function checkContainerHealth(opts: {
  containerId: string;
  hostPort: number;
  expectedContainerPort: number;
  config: HealthCheckConfig | null;
  userId?: string;
  deploymentId?: string;
  maxWaitMs?: number;
  dockerClient?: Docker;
}): Promise<HealthCheckResult> {
  if (!opts.config) {
    return postDeployHealthCheck({
      containerId: opts.containerId,
      hostPort: opts.hostPort,
      expectedContainerPort: opts.expectedContainerPort,
      userId: opts.userId,
      deploymentId: opts.deploymentId,
      maxWaitMs: opts.maxWaitMs,
      dockerClient: opts.dockerClient,
    });
  }
  return runConfiguredHealthCheck({ ...opts, config: opts.config });
}
