/**
 * Flutterwave v4 API client.
 *
 * v4 differs fundamentally from v3: instead of a static `FLUTTERWAVE_SECRET_KEY`
 * bearer, it uses OAuth2 client-credentials against Flutterwave's Keycloak IdP.
 * Access tokens are short-lived (observed: 600s), so every call goes through a
 * cached token that refreshes ahead of expiry. Fetching a token per request
 * would add a full round-trip to every payment operation and risk IdP rate
 * limits.
 *
 * The older v3 client lives in ./flutterwave.ts and is not wired to anything.
 */

import { logger } from "../../utils/logger";

const TOKEN_URL =
  process.env.FLW_V4_TOKEN_URL ??
  "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";

const BASE_URL = process.env.FLW_V4_BASE_URL ?? "https://f4bexperience.flutterwave.com";

/** Refresh this many ms before the token actually expires, to avoid racing it. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
/** De-dupes concurrent refreshes so a burst of calls triggers one token fetch. */
let inFlight: Promise<string> | null = null;

export function isFlutterwaveV4Configured(): boolean {
  return Boolean(process.env.FLW_V4_CLIENT_ID && process.env.FLW_V4_CLIENT_SECRET);
}

async function fetchToken(): Promise<string> {
  const clientId = process.env.FLW_V4_CLIENT_ID;
  const clientSecret = process.env.FLW_V4_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Flutterwave v4 is not configured (FLW_V4_CLIENT_ID / FLW_V4_CLIENT_SECRET)");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Flutterwave v4 auth failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Flutterwave v4 auth returned no access_token");
  }

  const ttlMs = (data.expires_in ?? 600) * 1000;
  cached = { token: data.access_token, expiresAt: Date.now() + ttlMs };

  logger.info("Flutterwave v4 access token refreshed", {
    expiresInSeconds: data.expires_in ?? 600,
  });

  return data.access_token;
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - EXPIRY_SKEW_MS) {
    return cached.token;
  }
  if (inFlight) return inFlight;

  inFlight = fetchToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export interface FlutterwaveV4Error {
  status: string;
  error?: { type?: string; code?: string; message?: string; validation_errors?: unknown };
}

/**
 * Authenticated request against the v4 API.
 *
 * `idempotencyKey` matters for anything that moves money: without it a retry
 * after a network timeout can create a second charge. Pass our own tx_ref.
 */
export async function flwV4Request<T = any>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    idempotencyKey?: string;
    /** Retry once on 401 in case the token was revoked before its stated expiry. */
    _retriedAuth?: boolean;
  } = {},
): Promise<T> {
  const { method = "GET", body, idempotencyKey } = options;
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // A token can be invalidated server-side before its advertised expiry.
  if (res.status === 401 && !options._retriedAuth) {
    cached = null;
    return flwV4Request<T>(path, { ...options, _retriedAuth: true });
  }

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Flutterwave v4 returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok || json?.status === "failed") {
    const err = (json as FlutterwaveV4Error).error;
    const msg = err?.message ?? `HTTP ${res.status}`;
    logger.error("Flutterwave v4 request failed", {
      path,
      method,
      status: res.status,
      code: err?.code,
      type: err?.type,
      message: msg,
    });
    throw new Error(`Flutterwave: ${msg}`);
  }

  return json as T;
}

/** Exposed for tests — drops the cached token so the next call re-authenticates. */
export function __resetTokenCacheForTests(): void {
  cached = null;
  inFlight = null;
}
