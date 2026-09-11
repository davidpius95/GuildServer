/**
 * Is a stored git-provider connection actually usable?
 *
 * A stored row only proves the user connected once. The provider can revoke the
 * grant at any time (the user removes the app, an admin resets the client
 * secret, a token is superseded), and the dashboard kept saying "Connected"
 * while every repository call failed with "Bad credentials".
 *
 * This asks the provider directly, after refreshing the token when it has
 * expired. Only an explicit 401 counts as dead: a timeout, rate limit or
 * provider outage reports "unknown" so a network blip never tells a user to
 * reconnect a working account. A healthy result is cached briefly so the
 * settings page can poll without spending the user's API quota; anything else
 * is re-checked every time, so a reconnect shows up immediately.
 */

import { getValidAccessToken, TokenRefreshRequiredError, type GitProvider } from "./oauth-tokens";
import { logger } from "../utils/logger";

export type ConnectionHealth = "connected" | "reconnect_required" | "unknown";

const PROBE_URLS: Record<Exclude<GitProvider, "google">, string> = {
  github: "https://api.github.com/user",
  gitlab: "https://gitlab.com/api/v4/user",
  bitbucket: "https://api.bitbucket.org/2.0/user",
};

const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

const cache = new Map<string, { health: ConnectionHealth; at: number }>();

/** Forget cached results, e.g. after the user reconnects or disconnects. */
export function clearConnectionHealth(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

export async function checkConnectionHealth(
  userId: string,
  provider: Exclude<GitProvider, "google">,
  { now = Date.now(), fetchImpl = fetch }: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<ConnectionHealth> {
  const key = `${userId}:${provider}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.health;

  const health = await probe(userId, provider, fetchImpl);
  if (health === "connected") cache.set(key, { health, at: now });
  return health;
}

async function probe(
  userId: string,
  provider: Exclude<GitProvider, "google">,
  fetchImpl: typeof fetch,
): Promise<ConnectionHealth> {
  let token: string;
  try {
    token = await getValidAccessToken(userId, provider);
  } catch (error) {
    if (error instanceof TokenRefreshRequiredError) return "reconnect_required";
    logger.warn("Could not load git connection token", { provider, error: (error as Error).message });
    return "unknown";
  }

  try {
    const response = await fetchImpl(PROBE_URLS[provider], {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: provider === "github" ? "application/vnd.github+json" : "application/json",
        "User-Agent": "GuildServer",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.ok) return "connected";
    if (response.status === 401) return "reconnect_required";
    return "unknown";
  } catch (error) {
    logger.warn("Git connection probe failed", { provider, error: (error as Error).message });
    return "unknown";
  }
}
