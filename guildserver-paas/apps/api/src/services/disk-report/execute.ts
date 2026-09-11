/**
 * Disk cleanup (W6): act on a disk report an admin has reviewed.
 *
 * The guarantees, each enforced by structure rather than care:
 *
 * - Dry run is the default. Deleting anything needs `dryRun: false`.
 * - Only images and idle build cache are removed. Volumes hold customer data
 *   and containers are customer workloads; the Docker client this module
 *   accepts has no volume or container methods, so it cannot touch either.
 * - An image is removed only if the admin selected it from a report AND it is
 *   still a "safe" candidate in a plan rebuilt from a fresh inventory right
 *   now. Anything deployed, configured or made a rollback target since the
 *   report was reviewed is therefore protected. Third-party images ("review"
 *   confidence) are never removed here.
 * - Images are removed without force, so Docker itself refuses to delete one
 *   that any container still uses.
 */

import type { CleanupPolicy, DiskReport } from "./policy";
import { buildDiskReport } from "./index";
import { docker as defaultDocker } from "../docker/client";
import { logger } from "../../utils/logger";

/** The only Docker calls cleanup can make. */
export interface CleanupDocker {
  getImage(id: string): { remove(options: { force: false; noprune: false }): Promise<unknown> };
  pruneBuilder(options: { filters: { until: string[] } }): Promise<{ SpaceReclaimed?: number }>;
}

export interface CleanupRequest {
  /** Image ids selected from a reviewed report. */
  imageIds: string[];
  /** Also prune build cache idle for longer than the policy allows. */
  includeBuildCache?: boolean;
  dryRun?: boolean;
  policy?: Partial<CleanupPolicy>;
}

export interface CleanupResult {
  dryRun: boolean;
  /** Removed, or on a dry run, would be removed. */
  images: Array<{ id: string; tags: string[]; sizeBytes: number }>;
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; error: string }>;
  buildCache: { idleForHours: number; bytesReclaimed: number | null } | null;
  /** Always zero. Present so any consumer can assert it. */
  volumesRemoved: 0;
}

export interface CleanupDeps {
  docker?: CleanupDocker;
  /** Builds the fresh plan the request is checked against. */
  buildReport?: (policy: Partial<CleanupPolicy>) => Promise<DiskReport>;
}

export async function executeCleanup(request: CleanupRequest, deps: CleanupDeps = {}): Promise<CleanupResult> {
  const dryRun = request.dryRun !== false;
  const docker = deps.docker ?? (defaultDocker as unknown as CleanupDocker);
  const buildReport = deps.buildReport ?? ((policy) => buildDiskReport({}, policy));
  const policy = request.policy ?? {};

  const fresh = await buildReport(policy);
  const candidates = new Map(fresh.imageCandidates.map((candidate) => [candidate.id, candidate]));

  const result: CleanupResult = { dryRun, images: [], skipped: [], failed: [], buildCache: null, volumesRemoved: 0 };

  for (const id of Array.from(new Set(request.imageIds))) {
    const candidate = candidates.get(id);
    if (!candidate) {
      result.skipped.push({ id, reason: "no longer a cleanup candidate (in use, configured, or a rollback target)" });
      continue;
    }
    if (candidate.confidence !== "safe") {
      result.skipped.push({ id, reason: "third-party image: remove it by hand after review" });
      continue;
    }
    if (!dryRun) {
      try {
        await docker.getImage(id).remove({ force: false, noprune: false });
      } catch (error) {
        result.failed.push({ id, error: (error as Error).message });
        continue;
      }
    }
    result.images.push({ id, tags: candidate.tags, sizeBytes: candidate.sizeBytes });
  }

  if (request.includeBuildCache) {
    const idleForHours = fresh.policy.buildCacheIdleDays * 24;
    let bytesReclaimed: number | null = null;
    if (!dryRun) {
      try {
        const pruned = await docker.pruneBuilder({ filters: { until: [`${idleForHours}h`] } });
        bytesReclaimed = pruned.SpaceReclaimed ?? 0;
      } catch (error) {
        result.failed.push({ id: "build-cache", error: (error as Error).message });
      }
    }
    result.buildCache = { idleForHours, bytesReclaimed };
  }

  if (!dryRun) {
    logger.info("Disk cleanup ran", {
      imagesRemoved: result.images.length,
      bytesUpTo: result.images.reduce((sum, image) => sum + image.sizeBytes, 0),
      skipped: result.skipped.length,
      failed: result.failed.length,
      buildCacheBytes: result.buildCache?.bytesReclaimed ?? null,
    });
  }

  return result;
}
