/**
 * Cloudflare for SaaS — Custom Hostnames API client.
 *
 * Lets GuildServer register arbitrary external domains (e.g. app.coolstartup.com)
 * as "custom hostnames" under the guild-technologies.com Cloudflare zone.
 * Cloudflare then terminates TLS and routes the traffic through the existing
 * Cloudflare Tunnel to Traefik, which already routes based on Host() rules.
 *
 * Ref: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
 * API: https://developers.cloudflare.com/api/resources/custom_hostnames/
 */

import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function getConfig() {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID || process.env.CF_ZONES;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const fallbackOrigin =
    process.env.CLOUDFLARE_FALLBACK_ORIGIN ||
    (process.env.BASE_DOMAIN ? `fallback.${process.env.BASE_DOMAIN}` : null);

  return { zoneId, apiToken, fallbackOrigin };
}

/** Returns true when all required env vars are present. */
export function isCloudflareSaasConfigured(): boolean {
  const { zoneId, apiToken } = getConfig();
  return !!(zoneId && apiToken);
}

// ---------------------------------------------------------------------------
// Types — Cloudflare API responses
// ---------------------------------------------------------------------------

export interface CfCustomHostname {
  id: string;
  hostname: string;
  status: CfCustomHostnameStatus;
  ssl: {
    id?: string;
    status: string;
    method: string;
    type: string;
    validation_records?: Array<{
      txt_name?: string;
      txt_value?: string;
      http_url?: string;
      http_body?: string;
      cname?: string;
      cname_target?: string;
      emails?: string[];
    }>;
    validation_errors?: Array<{ message: string }>;
    settings?: {
      min_tls_version?: string;
      http2?: string;
    };
  };
  ownership_verification?: {
    type: string;
    name: string;
    value: string;
  };
  ownership_verification_http?: {
    http_url: string;
    http_body: string;
  };
  verification_errors?: string[];
  created_at: string;
  custom_origin_server?: string;
}

export type CfCustomHostnameStatus =
  | "active"
  | "pending"
  | "active_redeploying"
  | "moved"
  | "pending_deletion"
  | "deleted"
  | "pending_blocked"
  | "pending_migration"
  | "pending_provisioned"
  | "test_pending"
  | "test_active"
  | "test_active_apex"
  | "test_blocked"
  | "test_failed"
  | "provisioned"
  | "blocked";

interface CfApiResponse<T> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result_info?: {
    page: number;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
}

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

async function cfFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const { apiToken, zoneId } = getConfig();
  if (!apiToken || !zoneId) {
    throw new Error(
      "Cloudflare for SaaS is not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID.",
    );
  }

  const url = `${CF_API_BASE}/zones/${zoneId}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  const fetchOpts: RequestInit = {
    method: options.method || "GET",
    headers,
  };

  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOpts);
  const json = (await response.json()) as CfApiResponse<T>;

  if (!json.success) {
    const errMsg = json.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || "Unknown error";
    logger.error(`Cloudflare API error: ${errMsg}`, { path, status: response.status });
    throw new Error(`Cloudflare API error: ${errMsg}`);
  }

  return json.result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateCustomHostnameOptions {
  /** The external domain, e.g. "app.coolstartup.com". */
  hostname: string;
  /**
   * SSL validation method. "http" is easiest (automatic if CNAME is set);
   * "txt" gives a TXT record the user can add alongside the CNAME;
   * "cname" uses a DCV CNAME delegation (recommended for many hostnames).
   */
  sslMethod?: "http" | "txt" | "cname";
}

export interface CreateCustomHostnameResult {
  /** Cloudflare's UUID for this custom hostname. */
  id: string;
  /** Current status (starts as "pending"). */
  status: CfCustomHostnameStatus;
  /** The full custom hostname object from Cloudflare. */
  customHostname: CfCustomHostname;
  /**
   * If a TXT ownership verification record is required, this contains the
   * name and value the user should add at their registrar.
   */
  ownershipVerification?: { name: string; value: string };
  /**
   * If SSL validation records are returned (for "txt" method), surface them
   * so the domain instructions can tell the user what to add.
   */
  sslValidationRecords?: CfCustomHostname["ssl"]["validation_records"];
}

/**
 * Register an external domain as a Custom Hostname on the GuildServer
 * Cloudflare zone. This tells Cloudflare to accept and proxy traffic for
 * this hostname through the existing tunnel.
 */
export async function createCustomHostname(
  opts: CreateCustomHostnameOptions,
): Promise<CreateCustomHostnameResult> {
  const { fallbackOrigin } = getConfig();

  const body: Record<string, unknown> = {
    hostname: opts.hostname,
    ssl: {
      method: opts.sslMethod || "http",
      type: "dv",
      settings: {
        min_tls_version: "1.2",
        http2: "on",
      },
    },
  };

  // If a fallback origin is configured, set it as the custom_origin_server.
  // This tells Cloudflare where to send the proxied traffic.
  if (fallbackOrigin) {
    body.custom_origin_server = fallbackOrigin;
  }

  logger.info(`Creating Cloudflare custom hostname: ${opts.hostname}`, {
    sslMethod: opts.sslMethod || "http",
    fallbackOrigin,
  });

  const result = await cfFetch<CfCustomHostname>("/custom_hostnames", {
    method: "POST",
    body,
  });

  return {
    id: result.id,
    status: result.status,
    customHostname: result,
    ownershipVerification: result.ownership_verification
      ? {
          name: result.ownership_verification.name,
          value: result.ownership_verification.value,
        }
      : undefined,
    sslValidationRecords: result.ssl?.validation_records,
  };
}

/**
 * Fetch the current status of a custom hostname from Cloudflare.
 * Returns null if the hostname no longer exists.
 */
export async function getCustomHostnameStatus(
  hostnameId: string,
): Promise<CfCustomHostname | null> {
  try {
    return await cfFetch<CfCustomHostname>(`/custom_hostnames/${hostnameId}`);
  } catch (error: any) {
    // 404 = hostname was deleted externally
    if (error?.message?.includes("1210") || error?.message?.includes("not found")) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a custom hostname from Cloudflare.
 * Safe to call even if the hostname was already deleted.
 */
export async function deleteCustomHostname(hostnameId: string): Promise<void> {
  try {
    await cfFetch<{ id: string }>(`/custom_hostnames/${hostnameId}`, {
      method: "DELETE",
    });
    logger.info(`Deleted Cloudflare custom hostname: ${hostnameId}`);
  } catch (error: any) {
    // Ignore 404 — hostname may have been manually deleted from the dashboard
    if (error?.message?.includes("1210") || error?.message?.includes("not found")) {
      logger.warn(`Cloudflare custom hostname ${hostnameId} already deleted`);
      return;
    }
    throw error;
  }
}

/**
 * List all custom hostnames in the zone. Supports pagination.
 */
export async function listCustomHostnames(opts?: {
  hostname?: string;
  page?: number;
  perPage?: number;
}): Promise<{ hostnames: CfCustomHostname[]; totalCount: number }> {
  const params = new URLSearchParams();
  if (opts?.hostname) params.set("hostname", opts.hostname);
  params.set("page", String(opts?.page || 1));
  params.set("per_page", String(opts?.perPage || 50));

  const { apiToken, zoneId } = getConfig();
  if (!apiToken || !zoneId) {
    throw new Error("Cloudflare for SaaS is not configured.");
  }

  const url = `${CF_API_BASE}/zones/${zoneId}/custom_hostnames?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });

  const json = (await response.json()) as CfApiResponse<CfCustomHostname[]>;
  if (!json.success) {
    const errMsg = json.errors?.map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`Cloudflare API error: ${errMsg}`);
  }

  return {
    hostnames: json.result,
    totalCount: json.result_info?.total_count || json.result.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a custom hostname is fully active (SSL provisioned, domain verified).
 */
export function isHostnameActive(ch: CfCustomHostname): boolean {
  return ch.status === "active" && ch.ssl?.status === "active";
}

/**
 * Extract human-readable verification instructions from a custom hostname
 * response, for displaying in the GuildServer dashboard.
 */
export function getVerificationInfo(ch: CfCustomHostname): {
  sslStatus: string;
  ownershipVerified: boolean;
  txtRecords: Array<{ name: string; value: string }>;
  httpValidation: Array<{ url: string; body: string }>;
} {
  const txtRecords: Array<{ name: string; value: string }> = [];
  const httpValidation: Array<{ url: string; body: string }> = [];

  if (ch.ssl?.validation_records) {
    for (const vr of ch.ssl.validation_records) {
      if (vr.txt_name && vr.txt_value) {
        txtRecords.push({ name: vr.txt_name, value: vr.txt_value });
      }
      if (vr.http_url && vr.http_body) {
        httpValidation.push({ url: vr.http_url, body: vr.http_body });
      }
    }
  }

  // Ownership verification via TXT
  if (ch.ownership_verification?.name && ch.ownership_verification?.value) {
    txtRecords.push({
      name: ch.ownership_verification.name,
      value: ch.ownership_verification.value,
    });
  }

  return {
    sslStatus: ch.ssl?.status || "unknown",
    ownershipVerified: ch.status === "active",
    txtRecords,
    httpValidation,
  };
}
