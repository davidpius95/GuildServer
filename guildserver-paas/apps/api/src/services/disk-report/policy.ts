/**
 * Decide what disk space could be reclaimed, without ever reclaiming it.
 *
 * This module is pure: it receives an inventory of what is on the daemon and
 * the references the platform still depends on, and returns a report. Nothing
 * here can delete anything, and nothing calls it that does. Enforcement is a
 * separate, future decision to be made after reviewing reports from a live host.
 *
 * The rule that matters most: an image is never a candidate if a rollback
 * could need it. Rollback redeploys the exact `imageTag` of a *completed*
 * deployment, so the newest completed deployments of each application, and any
 * completed within the retention window, are protected — as are images used by
 * any container, running or stopped, and the image each application is
 * configured to deploy.
 *
 * Volumes are never candidates. They hold customer data, and Docker's "not
 * referenced by a container right now" says nothing about whether the data is
 * wanted. They are listed for human review only.
 */

export interface ImageEntry {
  id: string;
  repoTags: string[];
  sizeBytes: number;
  /** Bytes shared with other images; not freed while those images remain. */
  sharedBytes: number;
  /** Containers (any state) using this image, as reported by the daemon. */
  containers: number;
  /** Unix seconds. */
  created: number;
}

export interface ContainerEntry {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: string;
  /** Unix seconds. */
  created: number;
  labels: Record<string, string>;
}

export interface VolumeEntry {
  name: string;
  labels: Record<string, string>;
  /** Containers referencing the volume; -1 when the daemon did not say. */
  refCount: number;
}

export interface BuildCacheEntry {
  sizeBytes: number;
  inUse: boolean;
  shared: boolean;
  lastUsedAt: string | null;
}

export interface FilesystemUsage {
  path: string;
  totalBytes: number;
  availableBytes: number;
}

export interface DiskInventory {
  images: ImageEntry[];
  containers: ContainerEntry[];
  volumes: VolumeEntry[];
  buildCache: BuildCacheEntry[];
  filesystem: FilesystemUsage | null;
}

/** The image an application is configured to deploy. */
export interface ConfiguredImage {
  applicationId: string;
  dockerImage: string;
  dockerTag: string | null;
}

/** The image of a completed deployment, which rollback may redeploy. */
export interface DeploymentImage {
  applicationId: string;
  imageTag: string;
  createdAt: Date;
}

export interface ReferenceData {
  configured: ConfiguredImage[];
  /** Completed deployments only: rollback refuses any other status. */
  deployments: DeploymentImage[];
}

export interface CleanupPolicy {
  /** Newest completed deployments per application whose images are kept. */
  rollbackKeepPerApp: number;
  /** Completed deployments newer than this are kept regardless of count. */
  rollbackRetentionDays: number;
  /** Unused build cache idle for longer than this is counted as reclaimable. */
  buildCacheIdleDays: number;
  /** Stopped platform containers older than this are listed for review. */
  stoppedContainerDays: number;
  warnPercent: number;
  criticalPercent: number;
}

export const DEFAULT_POLICY: CleanupPolicy = {
  rollbackKeepPerApp: 5,
  rollbackRetentionDays: 14,
  buildCacheIdleDays: 7,
  stoppedContainerDays: 30,
  warnPercent: 80,
  criticalPercent: 90,
};

export type ImageCategory = "dangling-image" | "expired-build" | "unused-image";
export type ProtectionReason = "in-use" | "rollback" | "configured";

export interface DiskReport {
  mode: "report";
  /** Always zero. Present so any consumer can assert it. */
  deletesPerformed: 0;
  generatedAt: string;
  policy: CleanupPolicy;
  filesystem:
    | (FilesystemUsage & { usedPercent: number; status: "ok" | "warning" | "critical" })
    | null;
  summary: {
    imageCandidates: number;
    /** Upper bound: every candidate's full size. */
    imageBytesUpTo: number;
    /** Lower bound: bytes no other image shares. */
    imageBytesAtLeast: number;
    buildCacheTotalBytes: number;
    buildCacheReclaimableBytes: number;
    stoppedContainers: number;
    volumesToReview: number;
  };
  imageCandidates: Array<{
    id: string;
    tags: string[];
    category: ImageCategory;
    /** "safe": platform-owned or untagged. "review": a third-party image. */
    confidence: "safe" | "review";
    sizeBytes: number;
    exclusiveBytes: number;
    createdAt: string;
  }>;
  protectedImages: Array<{ id: string; tags: string[]; reasons: ProtectionReason[] }>;
  stoppedContainers: Array<{ id: string; name: string; image: string; state: string; createdAt: string }>;
  volumesToReview: Array<{ name: string; managed: boolean }>;
  warnings: string[];
  notes: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Has this reference already got a tag? A colon after the last slash means yes. */
function hasTag(ref: string): boolean {
  const lastSlash = ref.lastIndexOf("/");
  return ref.slice(lastSlash + 1).includes(":");
}

/**
 * Canonical form for comparing image references: Docker Hub prefixes removed,
 * and an implicit ":latest" made explicit. Digests are left alone.
 */
export function normalizeImageRef(ref: string): string {
  let r = ref.trim();
  if (!r) return r;
  r = r.replace(/^docker\.io\/library\//, "").replace(/^docker\.io\//, "").replace(/^index\.docker\.io\/library\//, "");
  if (r.includes("@")) return r;
  return hasTag(r) ? r : `${r}:latest`;
}

/**
 * The reference an application actually deploys.
 *
 * Some applications store a tag inside docker_image AND a separate docker_tag
 * ("mongo:7" + "latest"), which naive concatenation turns into the invalid
 * "mongo:7:latest". The embedded tag wins, and the conflict is reported.
 */
export function configuredImageRef(dockerImage: string, dockerTag: string | null): { ref: string; conflicting: boolean } {
  const image = dockerImage.trim();
  const tag = (dockerTag ?? "").trim();
  if (hasTag(image) || image.includes("@")) {
    return { ref: normalizeImageRef(image), conflicting: tag.length > 0 && !image.endsWith(`:${tag}`) };
  }
  return { ref: normalizeImageRef(tag ? `${image}:${tag}` : image), conflicting: false };
}

/** References whose images a rollback may redeploy. */
export function rollbackProtectedRefs(deployments: DeploymentImage[], policy: CleanupPolicy, now: Date): Set<string> {
  const byApp = new Map<string, DeploymentImage[]>();
  for (const d of deployments) {
    if (!d.imageTag) continue;
    const list = byApp.get(d.applicationId) ?? [];
    list.push(d);
    byApp.set(d.applicationId, list);
  }
  const cutoff = now.getTime() - policy.rollbackRetentionDays * DAY_MS;
  const keep = new Set<string>();
  for (const list of byApp.values()) {
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    list.forEach((d, index) => {
      if (index < policy.rollbackKeepPerApp || d.createdAt.getTime() >= cutoff) {
        keep.add(normalizeImageRef(d.imageTag));
      }
    });
  }
  return keep;
}

function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function planCleanup(
  inventory: DiskInventory,
  references: ReferenceData,
  options: Partial<CleanupPolicy> = {},
  now: Date = new Date(),
): DiskReport {
  const policy: CleanupPolicy = { ...DEFAULT_POLICY, ...options };
  const warnings: string[] = [];

  const rollbackRefs = rollbackProtectedRefs(references.deployments, policy, now);

  const configuredRefs = new Set<string>();
  let conflicting = 0;
  for (const c of references.configured) {
    if (!c.dockerImage) continue;
    const { ref, conflicting: bad } = configuredImageRef(c.dockerImage, c.dockerTag);
    configuredRefs.add(ref);
    if (bad) conflicting++;
  }
  if (conflicting > 0) {
    warnings.push(
      `${conflicting} application(s) store a tag inside docker_image and a different docker_tag ` +
        `(e.g. "mongo:7" + "latest"), which concatenates to an invalid reference like "mongo:7:latest".`,
    );
  }

  const usedImageIds = new Set(inventory.containers.map((c) => c.imageId).filter(Boolean));
  const usedRefs = new Set(inventory.containers.map((c) => normalizeImageRef(c.image)).filter(Boolean));

  const imageCandidates: DiskReport["imageCandidates"] = [];
  const protectedImages: DiskReport["protectedImages"] = [];

  for (const image of inventory.images) {
    const tags = image.repoTags.filter((t) => t && t !== "<none>:<none>");
    const normalized = tags.map(normalizeImageRef);
    const reasons: ProtectionReason[] = [];

    if (image.containers > 0 || usedImageIds.has(image.id) || normalized.some((t) => usedRefs.has(t))) {
      reasons.push("in-use");
    }
    if (normalized.some((t) => rollbackRefs.has(t))) reasons.push("rollback");
    if (normalized.some((t) => configuredRefs.has(t))) reasons.push("configured");

    if (reasons.length > 0) {
      protectedImages.push({ id: image.id, tags, reasons });
      continue;
    }

    const category: ImageCategory =
      tags.length === 0 ? "dangling-image" : tags.some((t) => t.startsWith("gs-")) ? "expired-build" : "unused-image";

    imageCandidates.push({
      id: image.id,
      tags,
      category,
      confidence: category === "unused-image" ? "review" : "safe",
      sizeBytes: Math.max(0, image.sizeBytes),
      exclusiveBytes: Math.max(0, image.sizeBytes - Math.max(0, image.sharedBytes)),
      createdAt: isoFromUnix(image.created),
    });
  }

  const idleCutoff = now.getTime() - policy.buildCacheIdleDays * DAY_MS;
  let buildCacheTotal = 0;
  let buildCacheReclaimable = 0;
  for (const entry of inventory.buildCache) {
    const size = Math.max(0, entry.sizeBytes);
    buildCacheTotal += size;
    if (entry.inUse) continue;
    const last = entry.lastUsedAt ? Date.parse(entry.lastUsedAt) : NaN;
    if (Number.isNaN(last) || last < idleCutoff) buildCacheReclaimable += size;
  }

  const stoppedCutoff = now.getTime() / 1000 - policy.stoppedContainerDays * 86400;
  const stoppedContainers = inventory.containers
    .filter((c) => c.labels["gs.managed"] === "true" && ["exited", "dead", "created"].includes(c.state) && c.created < stoppedCutoff)
    .map((c) => ({ id: c.id, name: c.name, image: c.image, state: c.state, createdAt: isoFromUnix(c.created) }));

  // Unknown reference counts (-1) are not listed: absence of data is not evidence
  // that a volume is unused.
  const volumesToReview = inventory.volumes
    .filter((v) => v.refCount === 0)
    .map((v) => ({ name: v.name, managed: v.labels["gs.managed"] === "true" }));

  let filesystem: DiskReport["filesystem"] = null;
  if (inventory.filesystem && inventory.filesystem.totalBytes > 0) {
    const fs = inventory.filesystem;
    const usedPercent = ((fs.totalBytes - fs.availableBytes) / fs.totalBytes) * 100;
    const status = usedPercent >= policy.criticalPercent ? "critical" : usedPercent >= policy.warnPercent ? "warning" : "ok";
    filesystem = { ...fs, usedPercent: Math.round(usedPercent * 10) / 10, status };
  }

  return {
    mode: "report",
    deletesPerformed: 0,
    generatedAt: now.toISOString(),
    policy,
    filesystem,
    summary: {
      imageCandidates: imageCandidates.length,
      imageBytesUpTo: imageCandidates.reduce((n, c) => n + c.sizeBytes, 0),
      imageBytesAtLeast: imageCandidates.reduce((n, c) => n + c.exclusiveBytes, 0),
      buildCacheTotalBytes: buildCacheTotal,
      buildCacheReclaimableBytes: buildCacheReclaimable,
      stoppedContainers: stoppedContainers.length,
      volumesToReview: volumesToReview.length,
    },
    imageCandidates,
    protectedImages,
    stoppedContainers,
    volumesToReview,
    warnings,
    notes: [
      "Report only: nothing was deleted.",
      "Volumes are never cleanup candidates; the review list needs a human to confirm each owner.",
      "Image bytes are a range: shared layers are only freed once every image using them is gone.",
    ],
  };
}
