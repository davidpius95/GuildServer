import * as fs from "fs";
import * as path from "path";
import { db, domains, services } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { docker, GS_LABELS } from "./docker/client";

const TRAEFIK_DYNAMIC_DIR =
  process.env.TRAEFIK_DYNAMIC_DIR || "/etc/traefik/dynamic";

const DYNAMIC_FILE_NAME = "custom-domains.yml";

/** Traefik API URL for verifying live registered services. */
const TRAEFIK_API_URLS = [
  process.env.TRAEFIK_API_URL,
  "http://guildserver-traefik:8080",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
].filter(Boolean) as string[];

/**
 * Queries Traefik's internal API to discover all currently registered Docker services.
 * Times out quickly (1s) so it never hangs dynamic sync.
 */
async function getTraefikRegisteredServices(): Promise<Set<string>> {
  for (const baseUrl of TRAEFIK_API_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`${baseUrl}/api/http/services`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const services = (await res.json()) as Array<{ name: string }>;
        return new Set(services.map((s) => s.name.toLowerCase()));
      }
    } catch {
      // Try next candidate URL
    }
  }
  return new Set();
}

/**
 * Discovers the active Traefik service name for an application by inspecting:
 * 1. Live Docker container labels (app ID, service ID, container names).
 * 2. Traefik's live registered service list.
 * 3. Sanitized lowercase slug heuristics.
 */
async function resolveTraefikService(
  applicationId: string,
  appRecord: { name: string; appName?: string | null },
  traefikServices: Set<string>
): Promise<string | null> {
  // 1. Inspect Docker containers for application labels
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`${GS_LABELS.APP_ID}=${applicationId}`],
      },
    });

    if (containers.length === 0) {
      const svcContainers = await docker.listContainers({
        all: true,
        filters: {
          label: [`${GS_LABELS.SERVICE_ID}=${applicationId}`],
        },
      });
      containers.push(...svcContainers);
    }

    for (const c of containers) {
      for (const [key, val] of Object.entries(c.Labels || {})) {
        if (key.startsWith("traefik.http.routers.") && key.endsWith(".service")) {
          const serviceName = `${val.toLowerCase()}@docker`;
          if (traefikServices.size === 0 || traefikServices.has(serviceName)) {
            return serviceName;
          }
        }
        const svcMatch = key.match(/^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/);
        if (svcMatch?.[1]) {
          const serviceName = `${svcMatch[1].toLowerCase()}@docker`;
          if (traefikServices.size === 0 || traefikServices.has(serviceName)) {
            return serviceName;
          }
        }
      }
    }
  } catch {
    // Docker socket might be unavailable in some environments
  }

  // 2. Candidate slugs based on appName (slug) and display name
  const candidates = [
    appRecord.appName,
    appRecord.name,
  ]
    .filter(Boolean)
    .map((cand) => (cand as string).replace(/[^a-zA-Z0-9]/g, "-").toLowerCase());

  // Check if any candidate exists in Traefik's live services
  for (const cand of candidates) {
    const serviceName = `${cand}@docker`;
    if (traefikServices.has(serviceName)) {
      return serviceName;
    }
  }

  // Also check if any Traefik service contains the candidate prefix
  for (const cand of candidates) {
    for (const activeSvc of traefikServices) {
      if (activeSvc.startsWith(`${cand}-`) || activeSvc.includes(cand)) {
        return activeSvc;
      }
    }
  }

  // 3. Fallback heuristic:
  // If Traefik services were fetched and not empty, but this service is NOT registered,
  // the container is likely stopped or not deployed. Avoid writing a broken router.
  if (traefikServices.size > 0) {
    return null;
  }

  // If Traefik API was unreachable, fall back to best guess slug
  const fallbackCandidate = candidates[0] || "unknown";
  return `${fallbackCandidate}@docker`;
}

/**
 * Resolves the Traefik service name for a specific container in a stack.
 */
async function resolveStackTraefikService(
  stackId: string,
  composeServiceName: string,
  traefikServices: Set<string>
): Promise<string | null> {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`${GS_LABELS.SERVICE_ID}=${stackId}`],
      },
    });

    for (const c of containers) {
      if (c.Labels?.[GS_LABELS.COMPOSE_SERVICE] !== composeServiceName) continue;

      for (const [key, val] of Object.entries(c.Labels || {})) {
        if (key.startsWith("traefik.http.routers.") && key.endsWith(".service")) {
          const serviceName = `${val.toLowerCase()}@docker`;
          if (traefikServices.size === 0 || traefikServices.has(serviceName)) {
            return serviceName;
          }
        }
        const svcMatch = key.match(/^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/);
        if (svcMatch?.[1]) {
          const serviceName = `${svcMatch[1].toLowerCase()}@docker`;
          if (traefikServices.size === 0 || traefikServices.has(serviceName)) {
            return serviceName;
          }
        }
      }
    }
  } catch {
    // Docker socket might be unavailable in some environments
  }
  return null;
}

/**
 * Synchronize all verified custom domains directly into Traefik's dynamic
 * file configuration.
 *
 * Traefik watches this directory with `--providers.file.watch=true` and
 * updates its router rules instantly (under 10ms) without restarting any
 * containers or requiring an application redeploy.
 */
export async function syncTraefikDynamicDomains(): Promise<void> {
  try {
    const dynamicDir = path.resolve(TRAEFIK_DYNAMIC_DIR);

    // If the directory does not exist, try to create it
    if (!fs.existsSync(dynamicDir)) {
      try {
        fs.mkdirSync(dynamicDir, { recursive: true });
      } catch (mkdirErr) {
        logger.warn(
          `[traefik-dynamic] Traefik dynamic directory ${dynamicDir} does not exist and could not be created: ${(mkdirErr as Error).message}`
        );
        return;
      }
    }

    // Query all verified and active domains associated with applications
    const activeDomains = await db.query.domains.findMany({
      where: and(eq(domains.verified, true), eq(domains.status, "active")),
      with: {
        application: true,
      },
    });

    const traefikServices = await getTraefikRegisteredServices();

    const lines: string[] = [
      "# Auto-generated by GuildServer for dynamic custom domain routing",
      "# Do not edit manually — changes will be overwritten",
      "http:",
      "  routers:",
    ];

    let count = 0;
    for (const d of activeDomains) {
      if (!d.application) continue;
      const domainName = d.domain.trim().toLowerCase();
      if (!domainName) continue;

      const serviceName = await resolveTraefikService(
        d.applicationId || d.application.id,
        d.application,
        traefikServices
      );

      if (!serviceName) {
        logger.warn(
          `[traefik-dynamic] App "${d.application.name}" (${d.application.appName}) has no active container in Traefik. Skipping router for domain "${domainName}" until deployed.`
        );
        continue;
      }

      const routerKey = `custom-domain-${d.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      lines.push(`    ${routerKey}:`);
      lines.push(`      rule: "Host(\`${domainName}\`)"`);
      lines.push(`      service: "${serviceName}"`);
      lines.push(`      entryPoints:`);
      lines.push(`        - "web"`);
      lines.push(`        - "websecure"`);
      count++;
    }

    // Query stacks (services) with domains
    const allStacks = await db.query.services.findMany();
    for (const stack of allStacks) {
      const domainMap = (stack.domains ?? {}) as Record<string, string[]>;
      for (const [composeService, hostList] of Object.entries(domainMap)) {
        if (!Array.isArray(hostList)) continue;
        for (const host of hostList) {
          const domainName = (host || "").trim().toLowerCase();
          if (!domainName) continue;

          const serviceName = await resolveStackTraefikService(
            stack.id,
            composeService,
            traefikServices
          );

          if (!serviceName) continue;

          const routerKey = `custom-stack-${stack.id.slice(0, 8)}-${composeService}-${domainName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
          lines.push(`    ${routerKey}:`);
          lines.push(`      rule: "Host(\`${domainName}\`)"`);
          lines.push(`      service: "${serviceName}"`);
          lines.push(`      entryPoints:`);
          lines.push(`        - "web"`);
          lines.push(`        - "websecure"`);
          count++;
        }
      }
    }

    if (count === 0) {
      lines.push("    {}");
    }

    const content = lines.join("\n") + "\n";
    const targetFile = path.join(dynamicDir, DYNAMIC_FILE_NAME);
    const tempFile = path.join(dynamicDir, `.${DYNAMIC_FILE_NAME}.tmp`);

    // Atomic write
    fs.writeFileSync(tempFile, content, "utf8");
    fs.renameSync(tempFile, targetFile);

    logger.info(
      `[traefik-dynamic] Synchronized ${count} custom domain router(s) to ${targetFile}`
    );
  } catch (error) {
    logger.error(
      `[traefik-dynamic] Failed to synchronize custom domains to Traefik: ${(error as Error).message}`
    );
  }
}
