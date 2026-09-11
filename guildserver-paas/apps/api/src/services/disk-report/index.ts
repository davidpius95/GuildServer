/**
 * Disk safety report (W6), report mode only.
 *
 * Builds a picture of what could be reclaimed on the Docker host without
 * deleting anything. Turning this into enforcement is deliberately a separate,
 * later change, to be made only after reviewing reports from a live host.
 */

import { collectDiskInventory, collectReferences, type CollectDeps } from "./collect";
import { planCleanup, type CleanupPolicy, type DiskReport } from "./policy";

export * from "./policy";
export { collectDiskInventory, collectReferences } from "./collect";

export async function buildDiskReport(
  deps: CollectDeps = {},
  policy: Partial<CleanupPolicy> = {},
  now: Date = new Date(),
): Promise<DiskReport> {
  const [inventory, references] = await Promise.all([collectDiskInventory(deps), collectReferences(deps.database)]);
  return planCleanup(inventory, references, policy, now);
}
export { executeCleanup, type CleanupRequest, type CleanupResult, type CleanupDocker } from "./execute";
