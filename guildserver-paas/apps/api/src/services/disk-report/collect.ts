/**
 * Read-only collection of everything the disk report needs.
 *
 * Every call here is a GET against the Docker API or a SELECT against the
 * database. The collector has no way to remove anything, which keeps the
 * "report mode" guarantee structural rather than a matter of care.
 */

import { promises as fsp } from "fs";
import type Docker from "dockerode";
import { and, eq, isNotNull } from "drizzle-orm";
import { db as defaultDb, applications, deployments } from "@guildserver/database";
import { docker as defaultDocker } from "../docker/client";
import { logger } from "../../utils/logger";
import type { DiskInventory, ReferenceData } from "./policy";

type ReadOnlyDocker = Pick<Docker, "df" | "listContainers">;

type Statfs = (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;

export interface CollectDeps {
  docker?: ReadOnlyDocker;
  database?: typeof defaultDb;
  /** Filesystem to measure. Inside the API container "/" sits on the host's Docker disk. */
  statfsPath?: string;
  statfs?: Statfs;
}

export async function collectDiskInventory(deps: CollectDeps = {}): Promise<DiskInventory> {
  const d = deps.docker ?? (defaultDocker as unknown as ReadOnlyDocker);
  const [df, containers] = await Promise.all([d.df(), d.listContainers({ all: true })]);

  const path = deps.statfsPath ?? process.env.GS_DISK_REPORT_PATH ?? "/";
  let filesystem: DiskInventory["filesystem"] = null;
  try {
    const s = await (deps.statfs ?? (fsp.statfs as unknown as Statfs))(path);
    filesystem = { path, totalBytes: s.blocks * s.bsize, availableBytes: s.bavail * s.bsize };
  } catch (error) {
    // The rest of the report is still worth having without the percentage.
    logger.warn("Disk report could not read filesystem usage", { path, error: String((error as any)?.message ?? error) });
  }

  return {
    images: ((df?.Images ?? []) as any[]).map((i) => ({
      id: String(i.Id),
      repoTags: Array.isArray(i.RepoTags) ? i.RepoTags : [],
      sizeBytes: Number(i.Size) || 0,
      sharedBytes: Number(i.SharedSize) > 0 ? Number(i.SharedSize) : 0,
      containers: Number(i.Containers) > 0 ? Number(i.Containers) : 0,
      created: Number(i.Created) || 0,
    })),
    containers: (containers as any[]).map((c) => ({
      id: String(c.Id),
      name: String(c.Names?.[0] ?? "").replace(/^\//, ""),
      image: String(c.Image ?? ""),
      imageId: String(c.ImageID ?? ""),
      state: String(c.State ?? ""),
      created: Number(c.Created) || 0,
      labels: c.Labels ?? {},
    })),
    volumes: ((df?.Volumes ?? []) as any[]).map((v) => ({
      name: String(v.Name),
      labels: v.Labels ?? {},
      refCount: typeof v.UsageData?.RefCount === "number" ? v.UsageData.RefCount : -1,
    })),
    buildCache: ((df?.BuildCache ?? []) as any[]).map((b) => ({
      sizeBytes: Number(b.Size) || 0,
      inUse: Boolean(b.InUse),
      shared: Boolean(b.Shared),
      lastUsedAt: typeof b.LastUsedAt === "string" ? b.LastUsedAt : null,
    })),
    filesystem,
  };
}

export async function collectReferences(database: typeof defaultDb = defaultDb): Promise<ReferenceData> {
  const [configuredRows, deploymentRows] = await Promise.all([
    database
      .select({ applicationId: applications.id, dockerImage: applications.dockerImage, dockerTag: applications.dockerTag })
      .from(applications)
      .where(isNotNull(applications.dockerImage)),
    database
      .select({ applicationId: deployments.applicationId, imageTag: deployments.imageTag, createdAt: deployments.createdAt })
      .from(deployments)
      // Rollback refuses anything but a completed deployment with an image tag.
      .where(and(eq(deployments.status, "completed"), isNotNull(deployments.imageTag))),
  ]);

  return {
    configured: configuredRows
      .filter((r) => r.dockerImage)
      .map((r) => ({ applicationId: r.applicationId, dockerImage: r.dockerImage as string, dockerTag: r.dockerTag ?? null })),
    deployments: deploymentRows
      .filter((r) => r.applicationId && r.imageTag && r.createdAt)
      .map((r) => ({ applicationId: r.applicationId as string, imageTag: r.imageTag as string, createdAt: new Date(r.createdAt as any) })),
  };
}
