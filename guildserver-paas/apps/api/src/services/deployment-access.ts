import { isLocalhostDomain } from "./docker/client";

export interface BuildDeploymentAccessUrlOptions {
  hostPort: number;
  providerType?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  primaryDomain?: string | null;
  previewDomain?: string | null;
}

export interface UrlReachabilityResult {
  healthy: boolean;
  message: string;
  checkedUrl: string;
}

function getLxcIp(providerMetadata?: Record<string, unknown> | null): string | null {
  const value = providerMetadata?.lxcIp
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }
  return null
}

function buildDomainUrl(domain: string): string {
  return isLocalhostDomain(domain) ? `http://${domain}` : `https://${domain}`
}

export function buildDeploymentAccessUrl(opts: BuildDeploymentAccessUrlOptions): {
  accessUrl: string
  directUrl: string
} {
  const lxcIp = getLxcIp(opts.providerMetadata)
  const directUrl = lxcIp ? `http://${lxcIp}:${opts.hostPort}` : `http://localhost:${opts.hostPort}`

  if (opts.previewDomain) {
    return {
      accessUrl: buildDomainUrl(opts.previewDomain),
      directUrl,
    }
  }

  if (opts.primaryDomain) {
    return {
      accessUrl: buildDomainUrl(opts.primaryDomain),
      directUrl,
    }
  }

  if (opts.providerType === "proxmox" && lxcIp) {
    return {
      accessUrl: directUrl,
      directUrl,
    }
  }

  return {
    accessUrl: directUrl,
    directUrl,
  }
}

export async function waitForUrlReachable(opts: {
  url: string
  maxWaitMs?: number
  intervalMs?: number
  requestTimeoutMs?: number
}): Promise<UrlReachabilityResult> {
  const {
    url,
    maxWaitMs = 180_000,
    intervalMs = 2_000,
    requestTimeoutMs = 5_000,
  } = opts

  const start = Date.now()
  let attempt = 0
  let lastError = "timed out"

  while (Date.now() - start < maxWaitMs) {
    attempt += 1
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
        })

        if (response.ok || (response.status >= 300 && response.status < 400)) {
          return {
            healthy: true,
            message: `URL responded with HTTP ${response.status}`,
            checkedUrl: url,
          }
        }

        lastError = `HTTP ${response.status}`
      } finally {
        clearTimeout(timer)
      }
    } catch (error: any) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    if (Date.now() - start < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  return {
    healthy: false,
    message: `URL did not respond within ${Math.round(maxWaitMs / 1000)}s (${lastError})`,
    checkedUrl: url,
  }
}
