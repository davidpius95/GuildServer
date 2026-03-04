import Docker from "dockerode";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Docker Client Pool
// ---------------------------------------------------------------------------
// Manages cached `dockerode` instances for remote Docker daemons running
// inside LXC containers (or any remote Docker host). Each client connects
// via TCP to `host:port` (default port 2375).
//
// The local Docker client connects via the platform's Unix socket (or
// Windows named pipe).
// ---------------------------------------------------------------------------

interface PoolEntry {
  client: Docker;
  createdAt: Date;
}

/** In-memory cache of remote Docker clients, keyed by `host:port`. */
const clientPool = new Map<string, PoolEntry>();

/** Default TCP port for Docker daemon inside LXC containers. */
const DEFAULT_DOCKER_PORT = 2375;

/** Timeout (ms) to wait for Docker daemon readiness after LXC start. */
const DOCKER_READY_TIMEOUT_MS = 60_000;

/** Polling interval (ms) when waiting for Docker readiness. */
const DOCKER_READY_POLL_MS = 2_000;

// ---------------------------------------------------------------------------
// Local Docker client (singleton)
// ---------------------------------------------------------------------------

let localClient: Docker | null = null;

/**
 * Returns the local Docker client (connects via Unix socket / named pipe).
 * This is the same connection method used by the existing docker.ts module.
 */
export function getLocalDockerClient(): Docker {
  if (!localClient) {
    localClient = new Docker({
      socketPath:
        process.platform === "win32"
          ? "//./pipe/docker_engine"
          : "/var/run/docker.sock",
    });
  }
  return localClient;
}

// ---------------------------------------------------------------------------
// Remote Docker client pool
// ---------------------------------------------------------------------------

/**
 * Build a cache key from host and port.
 */
function cacheKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * Returns a (cached) `dockerode` instance connected via TCP to a remote
 * Docker daemon.
 *
 * @param host  IP address or hostname of the remote Docker daemon.
 * @param port  TCP port (default: 2375).
 */
export function getDockerClient(host: string, port: number = DEFAULT_DOCKER_PORT): Docker {
  const key = cacheKey(host, port);
  const existing = clientPool.get(key);

  if (existing) {
    logger.debug("Returning cached Docker client", { host, port });
    return existing.client;
  }

  logger.info("Creating new remote Docker client", { host, port });

  const client = new Docker({
    host,
    port,
    protocol: "http",
  });

  clientPool.set(key, {
    client,
    createdAt: new Date(),
  });

  return client;
}

/**
 * Remove a cached Docker client by its cache key (`host:port`) or by a
 * provider-specific identifier. Call this when a provider or node is deleted.
 *
 * @param key  The cache key (`host:port`) to remove.
 */
export function removeClient(key: string): void {
  if (clientPool.has(key)) {
    clientPool.delete(key);
    logger.info("Removed Docker client from pool", { key });
  }
}

/**
 * Remove a cached Docker client by host and port.
 */
export function removeClientByHost(host: string, port: number = DEFAULT_DOCKER_PORT): void {
  removeClient(cacheKey(host, port));
}

/**
 * Clear all cached Docker clients. Useful for testing.
 */
export function clearPool(): void {
  const size = clientPool.size;
  clientPool.clear();
  localClient = null;
  logger.info("Cleared Docker client pool", { previousSize: size });
}

/**
 * Return statistics about the current client pool.
 */
export function getPoolStats(): { size: number; keys: string[] } {
  return {
    size: clientPool.size,
    keys: Array.from(clientPool.keys()),
  };
}

// ---------------------------------------------------------------------------
// Connectivity helpers
// ---------------------------------------------------------------------------

/**
 * Test whether a Docker client can reach its daemon by issuing a `ping`.
 *
 * @param client  The `dockerode` instance to test.
 * @returns `true` if the daemon responded, `false` otherwise.
 */
export async function testDockerClient(client: Docker): Promise<boolean> {
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until a remote Docker daemon becomes responsive.
 *
 * After an LXC container is started, the Docker daemon inside it may take
 * 10-30 seconds to initialise. This function polls `client.ping()` until it
 * succeeds or the timeout expires.
 *
 * @param client     The `dockerode` instance to poll.
 * @param timeoutMs  Maximum wait time in milliseconds (default: 60 000).
 * @throws If Docker is not ready within the timeout period.
 */
export async function waitForDockerReady(
  client: Docker,
  timeoutMs: number = DOCKER_READY_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();

  logger.debug("Waiting for Docker daemon readiness", { timeoutMs });

  while (Date.now() - start < timeoutMs) {
    const ready = await testDockerClient(client);
    if (ready) {
      logger.info("Docker daemon is ready", {
        elapsedMs: Date.now() - start,
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, DOCKER_READY_POLL_MS));
  }

  throw new Error(
    `Docker daemon did not become ready within ${timeoutMs}ms`,
  );
}
