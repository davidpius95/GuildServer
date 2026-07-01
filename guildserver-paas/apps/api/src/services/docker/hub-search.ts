import { logger } from "../../utils/logger";

// Docker Hub public APIs (no auth required for public search/tags)
const HUB_SEARCH_URL = "https://hub.docker.com/v2/search/repositories/";
const HUB_REPO_BASE = "https://hub.docker.com/v2/repositories";

// Simple in-memory cache to avoid hammering Docker Hub (and getting rate-limited).
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expires: number; value: unknown }>();

function getCached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  if (hit) cache.delete(key);
  return undefined;
}

function setCached(key: string, value: unknown): void {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
}

export interface DockerHubImage {
  /** Full repo reference used for pulling, e.g. "nginx" or "bitnami/redis" */
  name: string;
  /** Short display name without the implicit "library/" namespace */
  displayName: string;
  namespace: string;
  isOfficial: boolean;
  isAutomated: boolean;
  starCount: number;
  pullCount: number;
  description: string;
}

export interface DockerHubTag {
  name: string;
  lastUpdated: string | null;
  /** Total image size in bytes (sum of layers), when available */
  size: number | null;
}

/**
 * Split a repository reference into { namespace, repo } for the Docker Hub API.
 * Official images (no slash) live under the "library" namespace.
 */
function splitRepository(repository: string): { namespace: string; repo: string } {
  const clean = repository.trim().replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/");
  if (parts.length === 1) return { namespace: "library", repo: parts[0] };
  // For "ns/repo" use as-is; ignore any extra path segments defensively.
  return { namespace: parts[0], repo: parts.slice(1).join("/") };
}

/** Search public Docker Hub repositories. */
export async function searchDockerHubImages(
  query: string,
  page = 1,
  pageSize = 25,
): Promise<DockerHubImage[]> {
  const q = query.trim();
  if (!q) return [];

  const cacheKey = `search:${q}:${page}:${pageSize}`;
  const cached = getCached<DockerHubImage[]>(cacheKey);
  if (cached) return cached;

  const url = `${HUB_SEARCH_URL}?query=${encodeURIComponent(q)}&page=${page}&page_size=${pageSize}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Docker Hub search returned ${res.status}`);
    }
    const data: any = await res.json();
    const results: DockerHubImage[] = (data.results || []).map((r: any) => {
      const repoName: string = r.repo_name || "";
      const isOfficial = !!r.is_official || repoName.startsWith("library/");
      const namespace = repoName.includes("/") ? repoName.split("/")[0] : "library";
      const displayName = isOfficial ? repoName.replace(/^library\//, "") : repoName;
      return {
        name: repoName.replace(/^library\//, ""),
        displayName,
        namespace,
        isOfficial,
        isAutomated: !!r.is_automated,
        starCount: Number(r.star_count) || 0,
        pullCount: Number(r.pull_count) || 0,
        description: (r.short_description || "").trim(),
      };
    });

    setCached(cacheKey, results);
    return results;
  } catch (error: any) {
    logger.warn(`Docker Hub search failed for "${q}": ${error.message}`);
    throw new Error(`Failed to search Docker Hub: ${error.message}`);
  }
}

/** List tags for a public Docker Hub repository, newest first. */
export async function listDockerHubTags(
  repository: string,
  pageSize = 50,
): Promise<DockerHubTag[]> {
  const repo = repository.trim();
  if (!repo) return [];

  const cacheKey = `tags:${repo}:${pageSize}`;
  const cached = getCached<DockerHubTag[]>(cacheKey);
  if (cached) return cached;

  const { namespace, repo: name } = splitRepository(repo);
  const url = `${HUB_REPO_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(
    name,
  )}/tags/?page_size=${pageSize}&ordering=last_updated`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error(`Docker Hub tags returned ${res.status}`);
    }
    const data: any = await res.json();
    const tags: DockerHubTag[] = (data.results || []).map((t: any) => ({
      name: t.name,
      lastUpdated: t.last_updated || null,
      size: typeof t.full_size === "number" ? t.full_size : null,
    }));

    setCached(cacheKey, tags);
    return tags;
  } catch (error: any) {
    logger.warn(`Docker Hub tag lookup failed for "${repo}": ${error.message}`);
    throw new Error(`Failed to load tags: ${error.message}`);
  }
}
