import { db, baasNodes, baasProjects } from "@guildserver/baas-db";
import { eq, and, sql } from "drizzle-orm";

export interface NodeSelectorOptions {
  minRamMb?: number;
  minStorageGb?: number;
  location?: string;
}

export async function selectNode(opts: NodeSelectorOptions = {}): Promise<string | null> {
  const nodes = await db
    .select()
    .from(baasNodes)
    .where(
      and(
        eq(baasNodes.status, "online"),
        eq(baasNodes.role, "compute"),
      )
    );

  const eligible = nodes.filter((n) => {
    const freeRam     = n.ramMbTotal - (n.ramMbUsed ?? 0);
    const freeStorage = n.storageGbTotal - (n.storageGbUsed ?? 0);
    if (opts.minRamMb     && freeRam     < opts.minRamMb)     return false;
    if (opts.minStorageGb && freeStorage < opts.minStorageGb) return false;
    if (opts.location     && n.location  !== opts.location)    return false;
    return true;
  });

  if (!eligible.length) return null;

  // Pick node with most available RAM (least saturated)
  eligible.sort((a, b) =>
    (b.ramMbTotal - (b.ramMbUsed ?? 0)) - (a.ramMbTotal - (a.ramMbUsed ?? 0))
  );

  return eligible[0].id;
}

export async function allocatePortBase(nodeId: string): Promise<number> {
  const projects = await db
    .select({ base: baasProjects.hostPortBase })
    .from(baasProjects)
    .where(eq(baasProjects.nodeId, nodeId));

  const usedBases = projects
    .map((p) => p.base)
    .filter((b): b is number => b !== null);

  return usedBases.length === 0 ? 9000 : Math.max(...usedBases) + 10;
}

export async function incrementNodeUsage(
  nodeId: string,
  delta: { ramMb: number; storageGb: number; vcpu: number }
) {
  await db
    .update(baasNodes)
    .set({
      ramMbUsed:     sql`ram_mb_used + ${delta.ramMb}`,
      storageGbUsed: sql`storage_gb_used + ${delta.storageGb}`,
      vcpuUsed:      sql`vcpu_used + ${delta.vcpu}`,
      updatedAt: new Date(),
    })
    .where(eq(baasNodes.id, nodeId));
}

export async function decrementNodeUsage(
  nodeId: string,
  delta: { ramMb: number; storageGb: number; vcpu: number }
) {
  await db
    .update(baasNodes)
    .set({
      ramMbUsed:     sql`GREATEST(0, ram_mb_used - ${delta.ramMb})`,
      storageGbUsed: sql`GREATEST(0, storage_gb_used - ${delta.storageGb})`,
      vcpuUsed:      sql`GREATEST(0, vcpu_used - ${delta.vcpu})`,
      updatedAt: new Date(),
    })
    .where(eq(baasNodes.id, nodeId));
}
