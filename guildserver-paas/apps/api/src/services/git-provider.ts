import simpleGit, { SimpleGit } from "simple-git";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

const CLONE_BASE_DIR = process.env.GIT_CLONE_DIR || path.join(process.cwd(), ".builds");

export interface CloneResult {
  localPath: string;
  commitSha: string;
  commitMessage: string;
  commitAuthor: string;
  branch: string;
}

export interface GitProviderConfig {
  provider: "github" | "gitlab" | "bitbucket" | "gitea" | "git";
  repository: string;
  branch: string;
  token?: string; // Personal access token or OAuth token
}

/**
 * Ensure the clone base directory exists
 */
function ensureCloneDir(): void {
  if (!fs.existsSync(CLONE_BASE_DIR)) {
    fs.mkdirSync(CLONE_BASE_DIR, { recursive: true });
    logger.info(`Created build directory: ${CLONE_BASE_DIR}`);
  }
}

/**
 * Build the authenticated clone URL based on provider
 */
function buildCloneUrl(config: GitProviderConfig): string {
  const { provider, repository, token } = config;

  // If it's already a full URL, use it directly
  if (repository.startsWith("http://") || repository.startsWith("https://")) {
    if (token) {
      const url = new URL(repository);
      // Insert token for authentication
      if (provider === "github" || provider === "gitea") {
        url.username = token;
        url.password = "x-oauth-basic";
      } else if (provider === "gitlab") {
        url.username = "oauth2";
        url.password = token;
      } else if (provider === "bitbucket") {
        url.username = "x-token-auth";
        url.password = token;
      }
      return url.toString();
    }
    return repository;
  }

  // Build URL from owner/repo format
  const baseUrls: Record<string, string> = {
    github: "https://github.com",
    gitlab: "https://gitlab.com",
    bitbucket: "https://bitbucket.org",
    gitea: process.env.GITEA_URL || "https://gitea.com",
    git: "",
  };

  const base = baseUrls[provider];
  if (!base) return repository;

  const fullUrl = `${base}/${repository}.git`;

  if (token) {
    const url = new URL(fullUrl);
    if (provider === "github" || provider === "gitea") {
      url.username = token;
      url.password = "x-oauth-basic";
    } else if (provider === "gitlab") {
      url.username = "oauth2";
      url.password = token;
    }
    return url.toString();
  }

  return fullUrl;
}

/**
 * Clone a git repository to a local directory
 */
export async function cloneRepository(
  config: GitProviderConfig,
  deploymentId: string,
  onLog?: (msg: string) => void
): Promise<CloneResult> {
  ensureCloneDir();

  const cloneDir = path.join(CLONE_BASE_DIR, deploymentId);
  const log = (msg: string) => {
    logger.info(`[git:${deploymentId}] ${msg}`);
    onLog?.(msg);
  };

  // Clean up if directory already exists
  if (fs.existsSync(cloneDir)) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }

  const cloneUrl = buildCloneUrl(config);
  // Log URL without credentials
  const safeUrl = config.repository.startsWith("http")
    ? config.repository
    : `${config.provider}:${config.repository}`;
  log(`Cloning ${safeUrl} (branch: ${config.branch})...`);

  try {
    const git: SimpleGit = simpleGit();

    // Clone with depth 1 for speed (shallow clone)
    await git.clone(cloneUrl, cloneDir, [
      "--branch", config.branch,
      "--depth", "1",
      "--single-branch",
    ]);

    log("Clone completed");

    // Get commit info
    const repoGit = simpleGit(cloneDir);
    const logResult = await repoGit.log({ maxCount: 1 });
    const latestCommit = logResult.latest;

    if (!latestCommit) {
      throw new Error("No commits found in repository");
    }

    log(`Latest commit: ${latestCommit.hash.slice(0, 8)} - ${latestCommit.message}`);

    return {
      localPath: cloneDir,
      commitSha: latestCommit.hash,
      commitMessage: latestCommit.message,
      commitAuthor: latestCommit.author_name,
      branch: config.branch,
    };
  } catch (error: any) {
    // Clean up on failure
    if (fs.existsSync(cloneDir)) {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }
    log(`ERROR: Clone failed: ${error.message}`);
    throw new Error(`Failed to clone repository: ${error.message}`);
  }
}

/**
 * Clean up a cloned repository directory
 */
export function cleanupClone(deploymentId: string): void {
  const cloneDir = path.join(CLONE_BASE_DIR, deploymentId);
  if (fs.existsSync(cloneDir)) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
    logger.debug(`Cleaned up clone directory: ${cloneDir}`);
  }
}

/**
 * Verify a GitHub webhook signature
 */
export function verifyGithubWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

/**
 * Verify a GitLab webhook token
 */
export function verifyGitlabWebhookToken(
  token: string,
  secret: string
): boolean {
  return token === secret;
}

/**
 * Parse a GitHub webhook push event
 */
export function parseGithubPushEvent(body: any): {
  repository: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  commitAuthor: string;
  sender: string;
} | null {
  if (!body?.ref || !body?.repository) return null;

  // Only handle branch pushes (not tags)
  if (!body.ref.startsWith("refs/heads/")) return null;

  const branch = body.ref.replace("refs/heads/", "");
  const headCommit = body.head_commit || body.commits?.[0];

  return {
    repository: body.repository.full_name, // e.g., "owner/repo"
    branch,
    commitSha: headCommit?.id || body.after || "",
    commitMessage: headCommit?.message || "",
    commitAuthor: headCommit?.author?.name || body.sender?.login || "",
    sender: body.sender?.login || "",
  };
}

/**
 * Parse a GitLab webhook push event
 */
export function parseGitlabPushEvent(body: any): {
  repository: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  commitAuthor: string;
  sender: string;
} | null {
  if (!body?.ref || !body?.project) return null;

  if (!body.ref.startsWith("refs/heads/")) return null;

  const branch = body.ref.replace("refs/heads/", "");
  const lastCommit = body.commits?.[body.commits.length - 1];

  return {
    repository: body.project.path_with_namespace,
    branch,
    commitSha: body.after || lastCommit?.id || "",
    commitMessage: lastCommit?.message || "",
    commitAuthor: lastCommit?.author?.name || body.user_name || "",
    sender: body.user_name || "",
  };
}

/**
 * List repositories for a GitHub user using their OAuth token
 */
export async function listGithubRepos(token: string): Promise<Array<{
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}>> {
  const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const repos = await response.json() as any[];
  return repos.map((repo) => ({
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
    defaultBranch: repo.default_branch,
    private: repo.private,
    url: repo.html_url,
  }));
}

/**
 * List branches for a GitHub repository
 */
export async function listGithubBranches(
  token: string,
  owner: string,
  repo: string
): Promise<string[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const branches = await response.json() as any[];
  return branches.map((b) => b.name);
}
