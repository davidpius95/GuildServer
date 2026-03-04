/**
 * Node Scheduler
 *
 * Decides which infrastructure node to deploy on using a least-connections /
 * most-available-resources strategy. Queries all online Proxmox providers,
 * fetches live resource usage from each, and returns the best candidate.
 *
 * If no healthy Proxmox nodes are available, falls back to local Docker.
 */

import { db, computeProviders } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { ProxmoxClient } from "./proxmox-client";
import type { ProxmoxConfig } from "../providers/types";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeCandidate {
  providerId: string;
  providerName: string;
  node: string;
  host: string;
  /** Number of LXC containers currently running on this node. */
  lxcCount: number;
  /** CPU usage fraction (0.0 – 1.0). */
  cpuUsage: number;
  /** Available CPU cores. */
  cpuCores: number;
  /** Memory usage fraction (0.0 – 1.0). */
  memoryUsage: number;
  /** Total memory in bytes. */
  memoryTotal: number;
  /** Available memory in bytes. */
  memoryAvailable: number;
  /** Composite score — lower is better (more resources available). */
  score: number;
}

export interface SchedulerResult {
  /** The selected provider, or null if no nodes are available. */
  provider: NodeCandidate | null;
  /** Why this node was selected (for logging). */
  reason: string;
  /** Whether the result is a fallback to local Docker. */
  fallbackToLocal: boolean;
  /** All candidates that were evaluated (for debugging). */
  candidates: NodeCandidate[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a composite score for a node candidate.
 *
 * Lower score = better candidate (more resources available).
 *
 * The scoring formula weighs:
 * - Memory availability (40%) — most critical for container workloads
 * - CPU availability (30%) — important for compute-bound apps
 * - Container count (30%) — load balancing / fairness
 *
 * Each factor is normalised to 0.0–1.0 where higher = more loaded.
 */
function computeScore(candidate: Omit<NodeCandidate, "score">): number {
  const memoryFactor = candidate.memoryUsage; // 0.0–1.0 fraction used
  const cpuFactor = candidate.cpuUsage;       // 0.0–1.0 fraction used
  // Container count factor: each container adds 0.05 to the score (capped at 1.0)
  const containerFactor = Math.min(candidate.lxcCount * 0.05, 1.0);

  return memoryFactor * 0.4 + cpuFactor * 0.3 + containerFactor * 0.3;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the best Proxmox node to deploy on.
 *
 * @param organizationId  Optional — if provided, prefers nodes belonging to
 *                        this organization. Falls back to global nodes.
 * @param excludeIds      Optional — provider IDs to exclude (e.g. failed nodes).
 *
 * @returns A {@link SchedulerResult} with the selected node (or fallback).
 */
export async function selectNode(
  organizationId?: string | null,
  excludeIds?: string[],
): Promise<SchedulerResult> {
  // Fetch all Proxmox providers that are online (status = "connected")
  const providers = await db.query.computeProviders.findMany({
    where: and(
      eq(computeProviders.type, "proxmox"),
      eq(computeProviders.status, "connected"),
    ),
  });

  // Filter out excluded IDs
  const eligible = excludeIds
    ? providers.filter((p) => !excludeIds.includes(p.id))
    : providers;

  if (eligible.length === 0) {
    return {
      provider: null,
      reason: "No online Proxmox providers available",
      fallbackToLocal: true,
      candidates: [],
    };
  }

  // Prefer org-specific providers if organizationId is given
  const orgProviders = organizationId
    ? eligible.filter((p) => p.organizationId === organizationId)
    : [];

  const pool = orgProviders.length > 0 ? orgProviders : eligible;

  // Query live stats from each provider in parallel
  const candidateResults = await Promise.allSettled(
    pool.map(async (provider): Promise<NodeCandidate> => {
      const config = provider.config as ProxmoxConfig;
      const client = new ProxmoxClient({
        host: config.host,
        port: config.port || 8006,
        tokenId: config.tokenId,
        tokenSecret: config.tokenSecret,
        allowInsecure: true,
      });

      // Fetch node status and LXC count in parallel
      const [nodeStatus, lxcList] = await Promise.all([
        client.getNodeStatus(config.node),
        client.listLXCs(config.node),
      ]);

      const memoryUsage = nodeStatus.maxmem > 0 ? nodeStatus.mem / nodeStatus.maxmem : 1;
      const memoryAvailable = nodeStatus.maxmem - nodeStatus.mem;

      const partial = {
        providerId: provider.id,
        providerName: provider.name,
        node: config.node,
        host: config.host,
        lxcCount: lxcList.length,
        cpuUsage: nodeStatus.cpu,
        cpuCores: nodeStatus.maxcpu,
        memoryUsage,
        memoryTotal: nodeStatus.maxmem,
        memoryAvailable,
      };

      return {
        ...partial,
        score: computeScore(partial),
      };
    }),
  );

  // Collect successful candidates
  const candidates: NodeCandidate[] = [];
  for (const result of candidateResults) {
    if (result.status === "fulfilled") {
      candidates.push(result.value);
    } else {
      logger.warn("Failed to query provider for scheduling", {
        error: result.reason?.message || String(result.reason),
      });
    }
  }

  if (candidates.length === 0) {
    return {
      provider: null,
      reason: "All Proxmox providers failed health checks during scheduling",
      fallbackToLocal: true,
      candidates: [],
    };
  }

  // Sort by score (lower = better)
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0]!;

  // Check if the best candidate has enough resources
  // Reject nodes with > 95% memory usage or > 95% CPU
  if (best.memoryUsage > 0.95 || best.cpuUsage > 0.95) {
    return {
      provider: null,
      reason: `Best candidate "${best.providerName}" is overloaded (CPU: ${Math.round(best.cpuUsage * 100)}%, Memory: ${Math.round(best.memoryUsage * 100)}%)`,
      fallbackToLocal: true,
      candidates,
    };
  }

  return {
    provider: best,
    reason: `Selected "${best.providerName}" (score: ${best.score.toFixed(3)}, containers: ${best.lxcCount}, CPU: ${Math.round(best.cpuUsage * 100)}%, Memory: ${Math.round(best.memoryUsage * 100)}%)`,
    fallbackToLocal: false,
    candidates,
  };
}

/**
 * Get the current load metrics for a specific provider node.
 *
 * Useful for displaying load information in the UI or for
 * manual node selection decisions.
 */
export async function getNodeLoad(
  providerId: string,
): Promise<NodeCandidate | null> {
  const provider = await db.query.computeProviders.findFirst({
    where: eq(computeProviders.id, providerId),
  });

  if (!provider || provider.type !== "proxmox") return null;

  const config = provider.config as ProxmoxConfig;
  const client = new ProxmoxClient({
    host: config.host,
    port: config.port || 8006,
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret,
    allowInsecure: true,
  });

  try {
    const [nodeStatus, lxcList] = await Promise.all([
      client.getNodeStatus(config.node),
      client.listLXCs(config.node),
    ]);

    const memoryUsage = nodeStatus.maxmem > 0 ? nodeStatus.mem / nodeStatus.maxmem : 1;

    const partial = {
      providerId: provider.id,
      providerName: provider.name,
      node: config.node,
      host: config.host,
      lxcCount: lxcList.length,
      cpuUsage: nodeStatus.cpu,
      cpuCores: nodeStatus.maxcpu,
      memoryUsage,
      memoryTotal: nodeStatus.maxmem,
      memoryAvailable: nodeStatus.maxmem - nodeStatus.mem,
    };

    return {
      ...partial,
      score: computeScore(partial),
    };
  } catch (err: any) {
    logger.error("Failed to get node load", {
      providerId,
      error: err.message,
    });
    return null;
  }
}
