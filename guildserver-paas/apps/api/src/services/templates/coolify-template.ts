/**
 * Parser and translator for Coolify's Compose service templates.
 *
 * Upstream: https://github.com/coollabsio/coolify — `templates/compose/*.yaml`,
 * Apache-2.0. See `docs/attribution/coolify.md`. The YAML files themselves are
 * vendored data; this module is GuildServer's own code for reading them.
 *
 * ---------------------------------------------------------------------------
 * Why a translation step exists
 * ---------------------------------------------------------------------------
 * Coolify's templates are not plain Compose. They carry "magic" environment
 * variables that only Coolify's PHP runtime understands — `SERVICE_PASSWORD_X`
 * is not a variable the template author set anywhere, it is a request for
 * Coolify to invent a password and inject it. Dropped into a stock Compose
 * engine those names resolve to the empty string and the stack comes up broken
 * but green, which is the worst possible failure mode.
 *
 * So we translate. Every magic name is classified into a declared requirement
 * (generate a secret / supply a domain / ask the user), and the Compose body is
 * rewritten so the only thing left in it is ordinary `${VAR}` interpolation.
 * The platform then materialises the values up front and hands them to the
 * Compose engine as a plain environment map.
 *
 * ---------------------------------------------------------------------------
 * The rules, taken from Coolify's own source
 * ---------------------------------------------------------------------------
 * `bootstrap/helpers/shared.php` (`parseEnvVariable`, `generateEnvValue`) and
 * `bootstrap/helpers/services.php` (`parseServiceUrlOrFqdn`) at the pinned
 * commit are the authority. Two families:
 *
 *   Generators   SERVICE_<COMMAND>_<IDENTIFIER>, where COMMAND is one of a
 *                closed set (PASSWORD, BASE64_64, HEX_32, USER, …). The
 *                identifier is just a label that ties uses of the same value
 *                together — two references to SERVICE_PASSWORD_DB get the
 *                same password.
 *
 *   Domains      SERVICE_URL_<SERVICE>[_<PORT>] and the SERVICE_FQDN_ variant.
 *                The trailing segment is a port only if it is numeric;
 *                otherwise it is part of the Compose service name.
 *
 * A name that starts with `SERVICE_` but whose command is not in the closed set
 * is NOT magic — it is an ordinary variable that happens to be named that way.
 * `SERVICE_ROLE_KEY` (Supabase) and `SERVICE_OPENAI_API_KEY` (Dify) are real
 * examples in the corpus, and treating them as generators would overwrite
 * credentials the user has to supply themselves. The closed-set check is what
 * keeps those apart, so do not loosen it into a prefix match.
 */

import { load as parseYaml } from "js-yaml";

// ---------------------------------------------------------------------------
// Generator commands
// ---------------------------------------------------------------------------

/** How a generated value is produced. The engine implements these, not Coolify. */
export type GeneratorKind =
  | "password"
  | "password_with_symbols"
  | "random_string"
  | "base64"
  | "hex"
  | "username"
  | "username_lowercase";

export interface GeneratorSpec {
  kind: GeneratorKind;
  /**
   * For `password`/`random_string`/`username`: character count.
   * For `base64`: bytes of entropy encoded (output is longer).
   * For `hex`: characters of hex output (half that many bytes).
   */
  length: number;
}

/**
 * Coolify's `generateEnvValue` switch, transcribed. Order matters only in that
 * lookup is longest-command-first; see `matchCommand`.
 *
 * Note Coolify's own comment on BASE64: "This is not base64, it's just a random
 * string". BASE64_* is an alphanumeric random string; REALBASE64_* is actual
 * base64 of random bytes. We keep that distinction because applications that
 * decode the value depend on it.
 */
const GENERATOR_COMMANDS: Record<string, GeneratorSpec> = {
  PASSWORD: { kind: "password", length: 32 },
  PASSWORD_64: { kind: "password", length: 64 },
  PASSWORDWITHSYMBOLS: { kind: "password_with_symbols", length: 32 },
  PASSWORDWITHSYMBOLS_64: { kind: "password_with_symbols", length: 64 },

  // Random alphanumeric strings, despite the name.
  BASE64: { kind: "random_string", length: 32 },
  BASE64_32: { kind: "random_string", length: 32 },
  BASE64_64: { kind: "random_string", length: 64 },
  BASE64_128: { kind: "random_string", length: 128 },

  // Genuine base64 of N random bytes.
  REALBASE64: { kind: "base64", length: 32 },
  REALBASE64_32: { kind: "base64", length: 32 },
  REALBASE64_64: { kind: "base64", length: 64 },
  REALBASE64_128: { kind: "base64", length: 128 },

  HEX_32: { kind: "hex", length: 32 },
  HEX_64: { kind: "hex", length: 64 },
  HEX_128: { kind: "hex", length: 128 },

  USER: { kind: "username", length: 16 },
  LOWERCASEUSER: { kind: "username_lowercase", length: 16 },
};

/**
 * Commands Coolify supports that GuildServer cannot yet produce.
 *
 * SUPABASEANON/SUPABASESERVICE are JWTs signed with the value of
 * SERVICE_PASSWORD_JWT — a derived variable, i.e. one generated value feeding
 * another. Nothing in our model expresses that dependency, so templates using
 * them are imported but held back from publication rather than shipped with a
 * silently empty key.
 */
const UNSUPPORTED_COMMANDS: Record<string, string> = {
  SUPABASEANON: "Supabase anon JWT must be signed with SERVICE_PASSWORD_JWT (derived value)",
  SUPABASESERVICE: "Supabase service JWT must be signed with SERVICE_PASSWORD_JWT (derived value)",
};

/** Longest-first so PASSWORD_64 wins over PASSWORD, BASE64_64 over BASE64. */
const KNOWN_COMMANDS = [...Object.keys(GENERATOR_COMMANDS), ...Object.keys(UNSUPPORTED_COMMANDS)].sort(
  (a, b) => b.length - a.length,
);

// ---------------------------------------------------------------------------
// Variable model
// ---------------------------------------------------------------------------

export interface GeneratedVariable {
  key: string;
  kind: "generated";
  generator: GeneratorSpec;
  /** The identifier segment; values sharing it must share a value. */
  identifier: string;
}

/** How a domain variable's label was matched to a real Compose service. */
export type DomainResolution = "exact" | "prefix" | "port" | "only-service" | "unresolved";

export interface DomainVariable {
  key: string;
  kind: "domain";
  /** `url` yields scheme://host, `fqdn` yields the bare host. */
  format: "url" | "fqdn";
  /**
   * The label upstream used, lowercased. This is NOT reliably a Compose service
   * name — `SERVICE_URL_ACTUAL_5006` labels a stack whose only service is
   * `actual_server`, and that mismatch is the norm rather than the exception in
   * the corpus. Use `targetService` for routing.
   */
  serviceName: string;
  /** Container port to route to, when the name carried one. */
  port: number | null;
  /**
   * The Compose service the proxy should route to, resolved from the label.
   * Null when no rule could identify one, which is a genuine defect.
   */
  targetService: string | null;
  resolution: DomainResolution;
}

export interface UnsupportedVariable {
  key: string;
  kind: "unsupported";
  command: string;
  reason: string;
}

export type TemplateVariable = GeneratedVariable | DomainVariable | UnsupportedVariable;

// ---------------------------------------------------------------------------
// Name classification
// ---------------------------------------------------------------------------

function matchCommand(rest: string): { command: string; identifier: string } | null {
  for (const command of KNOWN_COMMANDS) {
    if (rest === command) {
      // e.g. a bare `SERVICE_PASSWORD` with no identifier. Coolify treats the
      // empty remainder as no identifier; we key it off the command itself.
      return { command, identifier: command };
    }
    if (rest.startsWith(`${command}_`)) {
      const identifier = rest.slice(command.length + 1);
      if (identifier.length > 0) return { command, identifier };
    }
  }
  return null;
}

/**
 * Classify a `SERVICE_`-prefixed name.
 *
 * Returns null for names that are not magic at all — the caller must leave
 * those completely alone.
 */
export function classifyVariable(key: string): TemplateVariable | null {
  if (!key.startsWith("SERVICE_")) return null;
  const rest = key.slice("SERVICE_".length);

  if (rest.startsWith("URL_") || rest.startsWith("FQDN_")) {
    const format: "url" | "fqdn" = rest.startsWith("URL_") ? "url" : "fqdn";
    const tail = rest.slice(format === "url" ? 4 : 5);
    if (tail.length === 0) return null;

    // Trailing numeric segment is a port; anything else is part of the service
    // name. `SERVICE_FQDN_REDIS_CACHE_6379` → service redis_cache, port 6379.
    const lastUnderscore = tail.lastIndexOf("_");
    if (lastUnderscore > 0) {
      const maybePort = tail.slice(lastUnderscore + 1);
      if (/^\d+$/.test(maybePort)) {
        return {
          key,
          kind: "domain",
          format,
          serviceName: tail.slice(0, lastUnderscore).toLowerCase(),
          port: Number(maybePort),
          // Resolution needs the Compose body, which this function does not
          // have. `resolveDomainTargets` fills these in.
          targetService: null,
          resolution: "unresolved",
        };
      }
    }
    return {
      key,
      kind: "domain",
      format,
      serviceName: tail.toLowerCase(),
      port: null,
      targetService: null,
      resolution: "unresolved",
    };
  }

  const matched = matchCommand(rest);
  if (!matched) return null;

  const unsupported = UNSUPPORTED_COMMANDS[matched.command];
  if (unsupported) {
    return { key, kind: "unsupported", command: matched.command, reason: unsupported };
  }

  return {
    key,
    kind: "generated",
    generator: GENERATOR_COMMANDS[matched.command],
    identifier: matched.identifier,
  };
}

// ---------------------------------------------------------------------------
// Header metadata
// ---------------------------------------------------------------------------

export interface TemplateMetadata {
  documentation: string | null;
  slogan: string | null;
  category: string | null;
  tags: string[];
  logo: string | null;
  port: number | null;
  /** Extra ports the app needs, verbatim — e.g. "7777 tcp/udp, 8888 tcp". */
  ports: string | null;
  /** Upstream marks the template as not ready; we skip these. */
  ignore: boolean;
  /** Minimum Coolify version. Informational only. */
  minVersion: string | null;
  /** Template only runs on amd64. */
  amdOnly: boolean;
  /** `# IMPORTANT:` lines, surfaced to the user before deploy. */
  notices: string[];
}

const EMPTY_METADATA: TemplateMetadata = {
  documentation: null,
  slogan: null,
  category: null,
  tags: [],
  logo: null,
  port: null,
  ports: null,
  ignore: false,
  minVersion: null,
  amdOnly: false,
  notices: [],
};

/**
 * Read the `# key: value` header block.
 *
 * Only the leading run of comment lines is metadata. A `# category:` further
 * down the file is a comment inside the Compose body and must not be picked up,
 * so scanning stops at the first non-comment, non-blank line.
 */
export function parseMetadata(source: string): TemplateMetadata {
  const meta: TemplateMetadata = { ...EMPTY_METADATA, tags: [], notices: [] };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (!line.startsWith("#")) break;

    const body = line.slice(1).trim();
    const separator = body.indexOf(":");
    if (separator <= 0) continue;

    const key = body.slice(0, separator).trim().toLowerCase();
    const value = body.slice(separator + 1).trim();
    if (value === "") continue;

    switch (key) {
      case "documentation":
        meta.documentation = value;
        break;
      case "slogan":
        meta.slogan = value;
        break;
      case "category":
        meta.category = value.toLowerCase();
        break;
      case "tags":
        meta.tags = value
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0);
        break;
      case "logo":
        meta.logo = value;
        break;
      case "port": {
        const port = Number(value);
        meta.port = Number.isInteger(port) && port > 0 ? port : null;
        break;
      }
      case "ports":
        meta.ports = value;
        break;
      case "ignore":
        meta.ignore = value.toLowerCase() === "true";
        break;
      case "minversion":
        meta.minVersion = value;
        break;
      case "amd_only":
        meta.amdOnly = value.toLowerCase() === "true";
        break;
      case "important":
        meta.notices.push(value);
        break;
      default:
        break;
    }
  }

  return meta;
}

/** Strip the leading metadata comment block, leaving the Compose body. */
export function stripMetadataHeader(source: string): string {
  const lines = source.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (line === "" || line.startsWith("#")) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n").trimStart();
}

// ---------------------------------------------------------------------------
// Compose body translation
// ---------------------------------------------------------------------------

/**
 * A bare `- SERVICE_URL_APP_3000` entry in an `environment:` list is a Coolify
 * declaration: it both requests the value and injects it under that name. In
 * stock Compose a bare entry means "pass through from the host environment",
 * which would give the container an empty value.
 *
 * We rewrite it to `- SERVICE_URL_APP_3000=${SERVICE_URL_APP_3000}` so the
 * variable arrives through ordinary interpolation, preserving the name the
 * application reads.
 *
 * The `=<path>` form (`- SERVICE_URL_APPWRITE=/console`) appends a path to the
 * generated URL. That becomes `${SERVICE_URL_APPWRITE}/console`, keeping one
 * variable per domain while letting each container see its own path — Appwrite
 * declares three different paths off the same URL.
 */
const DECLARATION_LINE = /^(\s*-\s*)(SERVICE_[A-Z0-9_]+)(=(.*))?$/;

export interface TranslationResult {
  compose: string;
  variables: TemplateVariable[];
}

/**
 * Rewrite Coolify declarations into plain Compose interpolation and collect the
 * full set of variables the stack needs.
 *
 * References (`$SERVICE_PASSWORD_DB`, `${SERVICE_PASSWORD_DB}`) are deliberately
 * left byte-for-byte alone: both forms are already valid Compose interpolation,
 * so rewriting them would risk mangling nested forms like
 * `${_APP_DOMAIN:-$SERVICE_FQDN_APPWRITE}` for no gain. They are still scanned,
 * because a referenced variable must be declared even if it is never declared
 * by a bare entry.
 */
export function translateCompose(composeBody: string): TranslationResult {
  const byKey = new Map<string, TemplateVariable>();

  const record = (key: string) => {
    if (byKey.has(key)) return;
    const variable = classifyVariable(key);
    if (variable) byKey.set(key, variable);
  };

  const lines = composeBody.split(/\r?\n/).map((line) => {
    const match = DECLARATION_LINE.exec(line);
    if (!match) return line;

    const [, prefix, key, assignment, rawValue] = match;
    if (!classifyVariable(key)) return line; // not magic — leave it be

    if (assignment === undefined) {
      return `${prefix}${key}=\${${key}}`;
    }

    const value = (rawValue ?? "").trim();
    // A value that is already an interpolation (`SERVICE_URL_X=${SERVICE_URL_X}`)
    // or any non-path literal is left as the author wrote it.
    if (!value.startsWith("/")) return line;

    return `${prefix}${key}=\${${key}}${value}`;
  });

  const translated = lines.join("\n");

  // Scan the translated body for every magic name, in declarations and
  // references alike.
  for (const match of translated.matchAll(/SERVICE_[A-Z0-9_]+/g)) {
    record(match[0]);
  }

  return {
    compose: translated,
    variables: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// ---------------------------------------------------------------------------
// User-supplied variables
// ---------------------------------------------------------------------------

/**
 * A variable the template expects the operator to provide.
 *
 * Distinct from the magic ones: nothing generates these. Ghost's mysql service
 * has `MYSQL_DATABASE=${MYSQL_DATABASE}` with no default at all, so deploying
 * without asking the user gives MySQL an empty database name. Coolify surfaces
 * these in its UI; if we did not declare them the stack would come up broken
 * with no indication why.
 */
export interface UserVariable {
  key: string;
  /** No occurrence supplies a default, so a value must be collected. */
  required: boolean;
  /** The default upstream supplies, when it supplies one. */
  defaultValue: string | null;
}

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Collect every non-magic variable the Compose body references.
 *
 * A variable is required when NO occurrence of it carries a default. Templates
 * reference the same name both ways — Ghost uses `${MYSQL_DATABASE-ghost}` in
 * one service and bare `${MYSQL_DATABASE}` in another — and one default is
 * enough to keep the stack working, so the optional reading wins.
 */
export function collectUserVariables(compose: string): UserVariable[] {
  const found = new Map<string, UserVariable>();

  // `$$` is an escaped literal dollar, not a reference.
  for (const match of compose.split("$$").join(" ").matchAll(REFERENCE)) {
    const key = match[1] ?? match[4];
    if (!key || classifyVariable(key)) continue;

    const operator = match[2];
    const fallback = match[3];
    const hasDefault = operator !== undefined && operator.endsWith("-");

    const existing = found.get(key);
    if (!existing) {
      found.set(key, {
        key,
        required: !hasDefault,
        defaultValue: hasDefault ? (fallback ?? "") : null,
      });
      continue;
    }

    if (hasDefault) {
      existing.required = false;
      existing.defaultValue ??= fallback ?? "";
    }
  }

  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Whole-template parsing
// ---------------------------------------------------------------------------

export interface ComposeServiceSummary {
  name: string;
  image: string | null;
  /** True when the service declares its own healthcheck. */
  hasHealthcheck: boolean;
  /** Container ports the service exposes, from `ports:`/`expose:`. */
  ports: number[];
}

export interface ParsedTemplate {
  /** Stable id — the upstream filename without extension. */
  id: string;
  /** Human name derived from the id; the importer may refine it. */
  name: string;
  metadata: TemplateMetadata;
  /** Compose body with Coolify declarations translated. */
  compose: string;
  variables: TemplateVariable[];
  /** Variables the operator must or may supply; nothing generates these. */
  userVariables: UserVariable[];
  services: ComposeServiceSummary[];
  /** Non-fatal problems; a template with any of these is not publishable. */
  warnings: string[];
}

/**
 * Work out which Compose service each domain variable should route to.
 *
 * Coolify's label is free-form. `SERVICE_URL_ACTUAL_5006` sits in a file whose
 * only service is `actual_server`; `SERVICE_URL_APPWRITE` sits in a file with
 * thirty services. Treating the label as a service name and warning on mismatch
 * would flag 89 of 341 templates as broken when they are fine, so we resolve it
 * instead, cheapest and most certain rule first:
 *
 *   1. exact         label is a service name
 *   2. port          exactly one service exposes the port in the label
 *   3. prefix        exactly one service name starts with (or contains) the label
 *   4. only-service  the file has a single service, so there is no ambiguity
 *
 * A label that survives all four is genuinely unroutable and warns.
 */
function flatten(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, "");
}

export function resolveDomainTargets(
  variables: TemplateVariable[],
  services: ComposeServiceSummary[],
): void {
  const byName = new Map(services.map((service) => [service.name.toLowerCase(), service.name]));

  for (const variable of variables) {
    if (variable.kind !== "domain") continue;
    const label = variable.serviceName;

    const exact = byName.get(label);
    if (exact) {
      variable.targetService = exact;
      variable.resolution = "exact";
      continue;
    }

    if (variable.port !== null) {
      const exposing = services.filter((service) => service.ports.includes(variable.port!));
      if (exposing.length === 1) {
        variable.targetService = exposing[0].name;
        variable.resolution = "port";
        continue;
      }
    }

    // Labels drop separators that service names keep: SERVICE_URL_INVOICENINJA
    // against a service called `invoice-ninja`, SERVICE_URL_NEWAPI against
    // `new-api`. Compare with separators stripped from both sides.
    const flatLabel = flatten(label);
    const related = services.filter((service) => {
      const name = flatten(service.name);
      return name.startsWith(flatLabel) || flatLabel.startsWith(name) || name.includes(flatLabel);
    });
    if (related.length === 1) {
      variable.targetService = related[0].name;
      variable.resolution = "prefix";
      continue;
    }

    if (services.length === 1) {
      variable.targetService = services[0].name;
      variable.resolution = "only-service";
      continue;
    }

    variable.targetService = null;
    variable.resolution = "unresolved";
  }
}

export class TemplateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateParseError";
  }
}

function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summariseServices(compose: string): ComposeServiceSummary[] {
  let doc: unknown;
  try {
    doc = parseYaml(compose);
  } catch (error) {
    throw new TemplateParseError(
      `Compose body is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (doc === null || typeof doc !== "object") {
    throw new TemplateParseError("Compose body did not parse to a mapping");
  }

  const services = (doc as Record<string, unknown>).services;
  if (services === null || typeof services !== "object") {
    throw new TemplateParseError("Compose body has no `services` mapping");
  }

  const summaries: ComposeServiceSummary[] = [];
  for (const [name, rawDefinition] of Object.entries(services as Record<string, unknown>)) {
    const definition = (rawDefinition ?? {}) as Record<string, unknown>;
    const image = typeof definition.image === "string" ? definition.image : null;

    const ports = new Set<number>();
    for (const field of ["ports", "expose"]) {
      const value = definition[field];
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        // "3000", 3000, "8080:3000", "127.0.0.1:8080:3000/tcp" — the container
        // port is the last numeric segment before any protocol suffix.
        const text = String(entry).split("/")[0];
        const segments = text.split(":");
        const port = Number(segments[segments.length - 1]);
        if (Number.isInteger(port) && port > 0) ports.add(port);
      }
    }

    summaries.push({
      name,
      image,
      hasHealthcheck: typeof definition.healthcheck === "object" && definition.healthcheck !== null,
      ports: [...ports].sort((a, b) => a - b),
    });
  }

  if (summaries.length === 0) {
    throw new TemplateParseError("Compose body declares no services");
  }

  return summaries;
}

/**
 * Parse one upstream template file.
 *
 * Throws `TemplateParseError` for input that cannot be represented at all.
 * Recoverable defects are returned as `warnings`, which the importer uses to
 * hold a template back from publication.
 */
export function parseTemplate(id: string, source: string): ParsedTemplate {
  if (source.trim() === "") {
    throw new TemplateParseError("Template file is empty");
  }

  const metadata = parseMetadata(source);
  const body = stripMetadataHeader(source);
  if (body.trim() === "") {
    throw new TemplateParseError("Template has metadata but no Compose body");
  }

  const { compose, variables } = translateCompose(body);
  const services = summariseServices(compose);

  const warnings: string[] = [];
  if (metadata.ignore) warnings.push("Upstream marks this template `ignore: true`");
  if (metadata.amdOnly) warnings.push("Upstream marks this template amd64-only");
  if (!metadata.slogan) warnings.push("No slogan in upstream metadata");
  if (!metadata.category) warnings.push("No category in upstream metadata");

  for (const variable of variables) {
    if (variable.kind === "unsupported") {
      warnings.push(`Unsupported Coolify variable ${variable.key}: ${variable.reason}`);
    }
  }

  // A domain variable we cannot tie to any service means the proxy would have
  // nowhere to send traffic.
  resolveDomainTargets(variables, services);
  for (const variable of variables) {
    if (variable.kind !== "domain") continue;
    if (variable.resolution === "unresolved") {
      warnings.push(
        `Domain variable ${variable.key} could not be matched to any of this file's Compose services ` +
          `(${services.map((service) => service.name).join(", ")})`,
      );
    }
  }

  for (const service of services) {
    if (!service.image) {
      warnings.push(`Service "${service.name}" has no image (build-only services are not supported)`);
    }
  }

  return {
    id,
    name: titleCase(id),
    metadata,
    compose,
    variables,
    userVariables: collectUserVariables(compose),
    services,
    warnings,
  };
}
