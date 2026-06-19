import * as dns from "dns/promises";

export interface VerifyRedirectOptions {
  domain: string;
  expectedTarget: string;
}

export interface VerifyRedirectResult {
  status: "active" | "failed";
  finalUrl?: string;
  httpStatus?: number;
  reason?: string;
}

/**
 * Checks if an IP is private/loopback/link-local to prevent basic SSRF.
 */
function isPrivateIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (ip.toLowerCase().startsWith("fc00:") || ip.toLowerCase().startsWith("fd00:")) return true;
  return false;
}

/**
 * Normalizes a hostname by removing trailing dot and converting to lower case.
 */
function normalizeHostname(hostname: string): string {
  let normalized = hostname.toLowerCase().trim();
  if (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export interface VerifyDnsOptions {
  domain: string;
  /** Canonical host the CNAME should point at, e.g. "myapp.guildserver.io". */
  cnameTarget: string;
  /** Known public IPs of our server (resolved from BASE_DOMAIN). */
  serverIps: string[];
}

export interface VerifyDnsResult {
  status: "active" | "failed";
  reason?: string;
  /** What the domain currently resolves to, for surfacing in errors. */
  resolved?: string[];
}

/**
 * Verifies a "vanity" custom domain by checking its DNS points at our server:
 *  - a CNAME whose target matches the canonical app host, OR
 *  - A records that overlap with the server's IPs (covers apex A records and
 *    CNAMEs that resolve through to us).
 */
export async function verifyDns(opts: VerifyDnsOptions): Promise<VerifyDnsResult> {
  // For wildcard domains, verify against a concrete sample host under it.
  const base = opts.domain.startsWith("*.") ? opts.domain.slice(2) : opts.domain;
  const hostname = normalizeHostname(base);
  const expectedCname = normalizeHostname(opts.cnameTarget);

  // 1. CNAME match (typical for subdomains).
  try {
    const cnames = await dns.resolveCname(hostname);
    const normalized = cnames.map(normalizeHostname);
    if (normalized.includes(expectedCname)) {
      return { status: "active", resolved: cnames };
    }
  } catch {
    // No CNAME record (e.g. apex A record) — fall through to IP check.
  }

  // 2. A-record / resolved-IP match (covers apex A records and CNAME chains).
  try {
    const ips = await dns.resolve4(hostname);
    if (opts.serverIps.length > 0 && ips.some((ip) => opts.serverIps.includes(ip))) {
      return { status: "active", resolved: ips };
    }
    if (ips.length > 0) {
      return {
        status: "failed",
        resolved: ips,
        reason: opts.serverIps.length
          ? `${hostname} resolves to ${ips.join(", ")} but should point to ${opts.serverIps.join(", ")}`
          : `${hostname} resolves to ${ips.join(", ")}; could not determine our server IP to compare`,
      };
    }
  } catch (e: any) {
    if (e?.code === "ENOTFOUND" || e?.code === "ENODATA") {
      return {
        status: "failed",
        reason: `No DNS records found for ${hostname} yet. Add the record and allow time to propagate.`,
      };
    }
    return { status: "failed", reason: `DNS lookup failed: ${e?.message || "unknown error"}` };
  }

  return {
    status: "failed",
    reason: `${hostname} is not pointing to our servers yet. Check the record and DNS propagation.`,
  };
}

export async function verifyRedirect(
  opts: VerifyRedirectOptions
): Promise<VerifyRedirectResult> {
  let currentUrlStr = `https://${opts.domain}`;
  const maxHops = 5;
  const timeoutMs = 5000;
  let lastHttpStatus: number | undefined;

  const expectedHostname = normalizeHostname(opts.expectedTarget);

  // We loop for manual redirect following to inspect intermediate steps and avoid fetch's opaque error on timeout
  for (let hop = 0; hop < maxHops; hop++) {
    let currentUrl: URL;
    try {
      currentUrl = new URL(currentUrlStr);
    } catch (e) {
      return { status: "failed", reason: "Invalid domain URL" };
    }

    const currentHostname = normalizeHostname(currentUrl.hostname);

    // If we've arrived at the expected target hostname, it's a success
    if (currentHostname === expectedHostname) {
      return {
        status: "active",
        finalUrl: currentUrlStr,
        httpStatus: lastHttpStatus,
      };
    }

    // Resolve DNS and block private IPs to prevent SSRF
    try {
      const lookupResult = await dns.lookup(currentHostname);
      if (isPrivateIp(lookupResult.address)) {
        return {
          status: "failed",
          finalUrl: currentUrlStr,
          reason: `Resolved to a private IP address (${lookupResult.address})`,
          httpStatus: lastHttpStatus,
        };
      }
    } catch (e) {
      // Allow fallback if it's the very first request and we try http next, but usually if DNS fails, it fails
      return {
        status: "failed",
        finalUrl: currentUrlStr,
        reason: "domain not resolving",
      };
    }

    // Fetch the current URL
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrlStr, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "GuildServer-Domain-Verifier/1.0",
        },
      });

      clearTimeout(timeoutId);
      lastHttpStatus = response.status;

      // Check if it's a redirect
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            status: "failed",
            finalUrl: currentUrlStr,
            httpStatus: response.status,
            reason: "no redirect found (missing Location header)",
          };
        }

        // Construct the next URL (handles relative locations)
        const nextUrl = new URL(location, currentUrlStr);
        currentUrlStr = nextUrl.toString();
        continue;
      }

      // If it's a 200 OK or some other error but it's the FIRST hop and we tried HTTPS,
      // let's try HTTP as a fallback.
      if (hop === 0 && currentUrl.protocol === "https:") {
        currentUrlStr = `http://${opts.domain}`;
        continue; // Don't count this as a normal hop for redirect limits
      }

      // If not a redirect, we've hit the end of the line
      return {
        status: "failed",
        finalUrl: currentUrlStr,
        httpStatus: response.status,
        reason: `redirects to ${currentHostname}, expected ${expectedHostname}`,
      };
    } catch (e: any) {
      clearTimeout(timeoutId);

      // If it's the first hop on HTTPS, fallback to HTTP
      if (hop === 0 && currentUrlStr.startsWith("https://")) {
        currentUrlStr = `http://${opts.domain}`;
        continue;
      }

      if (e.name === "AbortError") {
        return {
          status: "failed",
          finalUrl: currentUrlStr,
          httpStatus: lastHttpStatus,
          reason: "timeout",
        };
      }

      return {
        status: "failed",
        finalUrl: currentUrlStr,
        httpStatus: lastHttpStatus,
        reason: `connection error: ${e.message}`,
      };
    }
  }

  return {
    status: "failed",
    finalUrl: currentUrlStr,
    httpStatus: lastHttpStatus,
    reason: "too many redirects",
  };
}
