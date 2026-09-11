import { docker } from "../docker/client";
import { logger } from "../../utils/logger";
import { LogDrainManager, type DockerLike } from "./manager";
import { loadDrainSpecs, saveDrainReport } from "./store";

let manager: LogDrainManager | null = null;

/**
 * Start forwarding logs for resources with an enabled drain. With no drains
 * configured this only re-reads the (empty) drain list periodically.
 * GS_LOG_DRAINS=0 turns it off entirely.
 */
export function startLogDrains(env: NodeJS.ProcessEnv = process.env): LogDrainManager | null {
  if (env.GS_LOG_DRAINS === "0") {
    logger.info("Log drains disabled (GS_LOG_DRAINS=0)");
    return null;
  }
  if (manager) return manager;
  manager = new LogDrainManager({
    docker: docker as unknown as DockerLike,
    loadDrains: loadDrainSpecs,
    saveReport: saveDrainReport,
    shipperDeps: { fetch: globalThis.fetch.bind(globalThis), env },
  });
  manager.start(parseInt(env.GS_LOG_DRAIN_RECONCILE_MS || "30000", 10));
  return manager;
}

export async function stopLogDrains(): Promise<void> {
  const current = manager;
  manager = null;
  await current?.stop();
}
