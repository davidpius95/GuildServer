/**
 * Repository access that does not depend on one person's GitHub login.
 *
 * A user's OAuth token dies when they revoke it, leave the organisation, or
 * GitHub expires it — and every deploy of every application that was connected
 * by that user then fails. A GitHub App installation token belongs to the
 * installation instead: it is minted on demand, lasts an hour, and keeps
 * working regardless of who connected the repository.
 *
 * This activates only when GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are set.
 * Without them, or on any failure, callers fall back to the user's OAuth token,
 * so a misconfigured App can never make deploys worse than they are today.
 */

import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";

/** Installation tokens last an hour; renew early so one never expires mid-clone. */
const RENEW_BEFORE_MS = 5 * 60_000;
/** GitHub rejects an App JWT issued more than 10 minutes ahead of expiry. */
const APP_JWT_TTL_SECONDS = 9 * 60;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

export function githubAppConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/** Forget cached installation tokens (used by tests and after a reinstall). */
export function clearInstallationTokens(): void {
  cache.clear();
}

/**
 * A short-lived JWT signed with the App's private key, which authenticates as
 * the App itself (not as any user) when asking GitHub about installations.
 */
export function createAppJwt(env: NodeJS.ProcessEnv = process.env, now: () => number = Date.now): string {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");

  const issuedAt = Math.floor(now() / 1000);
  return jwt.sign(
    // 60s back-dated: GitHub rejects a JWT whose iat is even slightly ahead of
    // its own clock.
    { iat: issuedAt - 60, exp: issuedAt + APP_JWT_TTL_SECONDS, iss: appId },
    // A key pasted into an env var usually arrives with escaped newlines.
    privateKey.replace(/\\n/g, "\n"),
    { algorithm: "RS256" },
  );
}

export interface InstallationTokenOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * An installation token that can clone `owner/repo`, or null when the App is
 * not configured, is not installed on that repository, or GitHub refuses.
 * Never throws: the caller falls back to the user's token.
 */
export async function installationTokenForRepository(
  owner: string,
  repo: string,
  { env = process.env, fetchImpl = fetch, now = Date.now }: InstallationTokenOptions = {},
): Promise<string | null> {
  if (!githubAppConfigured(env)) return null;

  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt - RENEW_BEFORE_MS > now()) return cached.token;

  try {
    const appJwt = createAppJwt(env, now);
    const headers = {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "GuildServer",
    };

    const installation = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/installation`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!installation.ok) {
      // 404 simply means the App is not installed on this repository.
      if (installation.status !== 404) {
        logger.warn("GitHub App could not resolve an installation", { owner, repo, status: installation.status });
      }
      return null;
    }
    const installationId = ((await installation.json()) as { id?: number }).id;
    if (!installationId) return null;

    const minted = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!minted.ok) {
      logger.warn("GitHub App could not mint an installation token", { owner, repo, status: minted.status });
      return null;
    }

    const body = (await minted.json()) as { token?: string; expires_at?: string };
    if (!body.token) return null;

    const expiresAt = body.expires_at ? Date.parse(body.expires_at) : now() + 60 * 60_000;
    cache.set(key, { token: body.token, expiresAt });
    return body.token;
  } catch (error) {
    // Includes a malformed private key: log the shape of the failure, never the key.
    logger.warn("GitHub App installation token unavailable", {
      owner,
      repo,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Can this user read this repository with their own GitHub identity?
 *
 * The platform is multi-tenant and one App serves every tenant, so an
 * installation token must never widen what someone can reach: without this,
 * a tenant could name another tenant's private repository and GuildServer
 * would clone it with the App's credentials. A user's own token answers the
 * only question that matters — is this repository yours to deploy?
 */
export async function userCanReadRepository(
  userToken: string,
  owner: string,
  repo: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "GuildServer",
      },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch (error) {
    // A network failure is not proof of access.
    logger.warn("Could not confirm repository access", { owner, repo, error: (error as Error).message });
    return false;
  }
}

/** Split "owner/repo", a full GitHub URL, or an SSH remote into its parts. */
export function parseRepository(repository: string): { owner: string; repo: string } | null {
  const cleaned = repository
    .trim()
    .replace(/^git@github\.com:/, "")
    .replace(/^https?:\/\/(?:[^@]+@)?github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts.slice(-2);
  return owner && repo ? { owner, repo } : null;
}
