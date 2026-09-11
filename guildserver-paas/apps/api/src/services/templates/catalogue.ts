/**
 * The one-click service catalogue: verified Compose templates, turned into a
 * stack a customer can deploy.
 *
 * Only templates marked `publishable` are offered — those that parse cleanly
 * and passed the deployment gate on a scratch runner at the vendored upstream
 * commit (scripts/verify-templates.ts).
 *
 * Planning a stack from a template:
 * - user variables: unknown keys are rejected, required ones must be non-empty,
 *   defaults are pinned so every Compose site agrees on one value;
 * - generated secrets are produced once per identifier, so services sharing a
 *   credential (an app and its database) get the same value;
 * - each service a domain variable targets gets `<service>-<stack>.<base
 *   domain>`, routed only if the service publishes a port Traefik can reach.
 *
 * Named volumes the upstream file mounts but never declares are declared, as
 * Coolify's own parser does; Compose itself refuses an undeclared volume.
 *
 * A domain variable such as SERVICE_URL_UPTIMEKUMA_3001 names the port the
 * service listens on. Coolify routes to that port even when the Compose file
 * publishes none, so a service with no `expose`/`ports` gets `expose` for it;
 * otherwise the service would deploy with no public URL.
 *
 * A template is offered only if it is publishable AND a stack planned from it
 * passes the same normalisation a real stack deploy runs. The verification
 * gate proves the images boot; this proves GuildServer's stack deployer accepts
 * the file. Templates needing something the deployer deliberately refuses
 * (cap_add, security_opt, a fixed container_name) are left out.
 *
 * The Compose body is stored as translated (still containing `${VAR}`), with
 * the values in the stack's environment: stack deploys interpolate it and
 * escape `$` for the Compose CLI's second pass, so generated passwords
 * containing `$` survive.
 */

import * as yaml from "js-yaml";
import {
  PUBLISHABLE_SERVICE_TEMPLATES,
  type ServiceTemplate,
} from "@guildserver/database/dist/seed/service-templates";
import { getServiceTemplateCompose } from "@guildserver/database/dist/seed/service-template-compose";
import { parseCompose } from "../compose/parse";
import { declareNamedVolumes, normalizeCompose, slugify } from "../compose/normalize";
import type { TemplateVariable, UserVariable } from "./coolify-template";
import { interpolateCompose, materializeVariables } from "./materialize";

export class TemplateInputError extends Error {
  constructor(message: string, readonly fields: string[] = []) {
    super(message);
    this.name = "TemplateInputError";
  }
}

export { declareNamedVolumes };

/**
 * Add `expose: ["<port>"]` to each service a domain variable routes to on a
 * known port, when the service publishes no port of its own. Returns the body
 * unchanged when nothing needs adding.
 */
export function exposeDomainPorts(
  composeBody: string,
  variables: ServiceTemplate["variables"],
  defaultPort?: number | null,
  templateServices?: ServiceTemplate["services"],
): string {
  const doc = yaml.load(composeBody) as Record<string, any> | null;
  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object") return composeBody;

  let changed = false;
  for (const variable of variables) {
    if (variable.kind !== "domain" || !variable.targetService) continue;
    const targetService = variable.targetService;
    const service = doc.services[targetService];
    if (!service || typeof service !== "object") continue;
    const hasExpose = Array.isArray(service.expose) && service.expose.length > 0;
    const hasPorts = Array.isArray(service.ports) && service.ports.length > 0;
    if (hasExpose || hasPorts) continue;

    let resolvedPort = variable.port ?? null;
    if (!resolvedPort && templateServices) {
      const match = templateServices.find((s) => s.name === targetService);
      if (match && match.ports.length > 0) {
        resolvedPort = match.ports[0];
      }
    }
    if (!resolvedPort && defaultPort) {
      if (variable.format === "url" || (templateServices && templateServices.length === 1)) {
        resolvedPort = defaultPort;
      }
    }
    if (!resolvedPort) continue;

    service.expose = [String(resolvedPort)];
    changed = true;
  }
  return changed ? yaml.dump(doc, { lineWidth: -1, noRefs: true }) : composeBody;
}

export interface CatalogueEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  documentationUrl: string | null;
  logo: string | null;
  notices: string[];
  services: Array<{ name: string; image: string | null }>;
  userVariables: Array<{ key: string; required: boolean; defaultValue: string | null }>;
  /** Compose services that get a public URL. */
  publicServices: string[];
}

export function toCatalogueEntry(template: ServiceTemplate): CatalogueEntry {
  const publicServices = new Set<string>();
  for (const variable of template.variables) {
    if (variable.kind === "domain" && variable.targetService) publicServices.add(variable.targetService);
  }
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    documentationUrl: template.documentationUrl,
    logo: template.logo,
    notices: template.notices,
    services: template.services.map((service) => ({ name: service.name, image: service.image })),
    userVariables: template.userVariables.map(({ key, required, defaultValue }) => ({ key, required, defaultValue })),
    publicServices: Array.from(publicServices),
  };
}

export interface PlanOptions {
  /** slugify(stack name); part of every generated hostname. */
  stackSlug: string;
  baseDomain: string;
  /** Whether public URLs are https (anything not on a *.localhost base domain). */
  https: boolean;
  userValues: Record<string, string>;
}

export interface TemplateStackPlan {
  composeFile: string;
  environment: Record<string, string>;
  /** Compose service -> hostnames, in the shape service.create takes. */
  domains: Record<string, string[]>;
  urls: Array<{ service: string; url: string }>;
  warnings: string[];
}

export function planTemplateStack(
  template: ServiceTemplate,
  composeBody: string,
  options: PlanOptions,
): TemplateStackPlan {
  const known = new Set(template.userVariables.map((variable) => variable.key));
  const unknown = Object.keys(options.userValues).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new TemplateInputError(`Unknown variable(s) for ${template.name}: ${unknown.join(", ")}`, unknown);
  }
  const missingRequired = template.userVariables
    .filter((variable) => variable.required && !(options.userValues[variable.key] ?? "").trim())
    .map((variable) => variable.key);
  if (missingRequired.length > 0) {
    throw new TemplateInputError(`${template.name} needs a value for: ${missingRequired.join(", ")}`, missingRequired);
  }

  composeBody = exposeDomainPorts(
    declareNamedVolumes(composeBody),
    template.variables,
    template.defaultPort,
    template.services,
  );
  const parsed = parseCompose(composeBody);
  const routable = new Set(
    parsed.services.filter((service) => service.expose.length > 0 || service.ports.length > 0).map((s) => s.name),
  );

  const scheme = options.https ? "https" : "http";
  const hostFor = (service: string) => `${slugify(service)}-${options.stackSlug}.${options.baseDomain}`;
  const domains: Record<string, string[]> = {};
  const warnings: string[] = [];
  const unrouted = new Set<string>();

  const environment = materializeVariables(template.variables as TemplateVariable[], {
    resolveDomain: (variable) => {
      const service = variable.targetService ?? variable.serviceName;
      const host = hostFor(service);
      if (variable.targetService && routable.has(variable.targetService)) {
        const hosts = domains[variable.targetService] ?? (domains[variable.targetService] = []);
        if (!hosts.includes(host)) hosts.push(host);
      } else if (!unrouted.has(service)) {
        unrouted.add(service);
        warnings.push(`"${service}" does not publish a port, so ${host} is not routed to it.`);
      }
      return variable.format === "fqdn" ? host : `${scheme}://${host}`;
    },
    userVariables: template.userVariables as UserVariable[],
    existing: options.userValues,
  });

  const { missing } = interpolateCompose(composeBody, environment);
  if (missing.length > 0) {
    throw new TemplateInputError(`${template.name} references values the catalogue cannot supply: ${missing.join(", ")}`, missing);
  }

  const urls = Object.entries(domains).flatMap(([service, hosts]) =>
    hosts.map((host) => ({ service, url: `${scheme}://${host}` })),
  );
  return { composeFile: composeBody, environment, domains, urls, warnings };
}

export interface CatalogueExclusion {
  id: string;
  reason: string;
}

let catalogue: { templates: ServiceTemplate[]; excluded: CatalogueExclusion[] } | null = null;

/**
 * Publishable templates a stack deploy will accept, checked once per process
 * by planning each with placeholder values and normalising the result exactly
 * as a deploy would.
 */
export function deployableCatalogue(): { templates: ServiceTemplate[]; excluded: CatalogueExclusion[] } {
  if (catalogue) return catalogue;
  const templates: ServiceTemplate[] = [];
  const excluded: CatalogueExclusion[] = [];
  for (const template of PUBLISHABLE_SERVICE_TEMPLATES) {
    const compose = getServiceTemplateCompose(template.id);
    if (!compose) {
      excluded.push({ id: template.id, reason: "no Compose body is bundled" });
      continue;
    }
    try {
      const userValues = Object.fromEntries(
        template.userVariables.filter((variable) => variable.required).map((variable) => [variable.key, "placeholder"]),
      );
      const plan = planTemplateStack(template, compose, {
        stackSlug: "catalogue-check",
        baseDomain: "example.com",
        https: true,
        userValues,
      });
      normalizeCompose({
        service: {
          id: "00000000-0000-0000-0000-000000000000",
          serviceName: "catalogue-check",
          projectId: "00000000-0000-0000-0000-000000000000",
          environment: plan.environment,
          domains: plan.domains,
        },
        composeFile: plan.composeFile,
      });
      templates.push(template);
    } catch (error) {
      excluded.push({ id: template.id, reason: (error as Error).message.split("\n").slice(0, 3).join(" ") });
    }
  }
  catalogue = { templates, excluded };
  return catalogue;
}
