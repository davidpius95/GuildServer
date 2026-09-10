#!/usr/bin/env tsx
/**
 * Import Coolify's Compose service templates into GuildServer's catalogue.
 *
 *   pnpm tsx scripts/import-coolify-templates.ts [--offline <dir>] [--dry-run]
 *
 * ---------------------------------------------------------------------------
 * What this does and why it is a build-time step
 * ---------------------------------------------------------------------------
 * Coolify publishes 371 Compose templates under Apache-2.0. They are data, not
 * code, which is the one part of the parity programme that genuinely transfers
 * between a PHP application and this one.
 *
 * The templates are fetched ONCE, here, from a PINNED COMMIT, and vendored into
 * the repository as generated TypeScript. Nothing fetches at runtime. That is
 * deliberate:
 *
 *   - A deploy must not depend on GitHub being reachable, or on upstream not
 *     having force-pushed.
 *   - Vendoring is what makes the Apache-2.0 attribution auditable: the exact
 *     bytes we redistribute are in the tree, next to the commit they came from.
 *   - An upstream template change becomes a reviewable diff rather than a
 *     silent change in what customers deploy.
 *
 * Bumping the pin is a deliberate act: change UPSTREAM_COMMIT, re-run, review
 * the diff, re-run the verification gate, and update docs/attribution/coolify.md.
 *
 * ---------------------------------------------------------------------------
 * Publishability
 * ---------------------------------------------------------------------------
 * Importing a template does NOT make it available to customers. A template is
 * publishable only when it parses cleanly, has no warnings, and has passed
 * scripts/verify-templates.ts on a scratch Docker daemon — recorded in
 * scripts/verified-templates.json. Quality over count: a catalogue of 25
 * templates that genuinely deploy beats 371 that half-work.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { gunzipSync } from "zlib";

import {
  parseTemplate,
  TemplateParseError,
  type ParsedTemplate,
  type TemplateVariable,
} from "../apps/api/src/services/templates/coolify-template";

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

const UPSTREAM_REPO = "coollabsio/coolify";
/** Pinned upstream commit. Changing this is a deliberate, reviewed act. */
const UPSTREAM_COMMIT = "424dbd36fff39a9ccd22efbee019cf490dcf9fc8";
const UPSTREAM_PATH = "templates/compose";
const UPSTREAM_LICENSE = "Apache-2.0";

const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_INDEX = join(REPO_ROOT, "packages/database/src/seed/service-templates.ts");
const OUTPUT_COMPOSE = join(REPO_ROOT, "packages/database/src/seed/service-template-compose.ts");
const LEDGER_PATH = join(REPO_ROOT, "scripts/verified-templates.json");

// ---------------------------------------------------------------------------
// Verification ledger
// ---------------------------------------------------------------------------

export interface VerificationLedger {
  /** Commit the recorded results were produced against. */
  upstreamCommit: string;
  verifiedAt: string | null;
  /** Template ids that deployed and became healthy on a scratch daemon. */
  passed: string[];
  /** Template ids that were tried and failed, with the reason. */
  failed: Record<string, string>;
}

export const EMPTY_LEDGER: VerificationLedger = {
  upstreamCommit: UPSTREAM_COMMIT,
  verifiedAt: null,
  passed: [],
  failed: {},
};

export function readLedger(path = LEDGER_PATH): VerificationLedger {
  if (!existsSync(path)) return { ...EMPTY_LEDGER };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as VerificationLedger;

  // Results from a different upstream commit describe different templates and
  // must not be trusted to mark anything publishable.
  if (parsed.upstreamCommit !== UPSTREAM_COMMIT) {
    console.warn(
      `⚠ verified-templates.json was produced against ${parsed.upstreamCommit}, not the current pin ` +
        `${UPSTREAM_COMMIT}. Treating every template as unverified.`,
    );
    return { ...EMPTY_LEDGER };
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Fetching the pinned tree
// ---------------------------------------------------------------------------

interface SourceFile {
  /** Path within the upstream repository, for attribution. */
  upstreamPath: string;
  id: string;
  contents: string;
}

/**
 * Minimal tar reader.
 *
 * The alternative is shelling out to `tar` or taking a dependency; a tar entry
 * is a 512-byte header plus content padded to 512, so reading it here keeps the
 * importer dependency-free and platform-independent.
 */
function* readTar(buffer: Buffer): Generator<{ name: string; contents: Buffer }> {
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);

    // Two consecutive zero blocks terminate the archive.
    if (header.every((byte) => byte === 0)) return;

    let name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeField = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeField, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);

    // ustar long-name prefix.
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    if (prefix) name = `${prefix}/${name}`;

    offset += 512;
    const contents = buffer.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    // '0' and '\0' are regular files; skip directories and metadata entries.
    if (typeFlag === "0" || typeFlag === "\0") {
      yield { name, contents };
    }
  }
}

async function fetchUpstreamTemplates(): Promise<SourceFile[]> {
  const url = `https://codeload.github.com/${UPSTREAM_REPO}/tar.gz/${UPSTREAM_COMMIT}`;
  console.log(`Fetching ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pinned tarball: ${response.status} ${response.statusText}`);
  }

  const tar = gunzipSync(Buffer.from(await response.arrayBuffer()));
  const files: SourceFile[] = [];

  for (const entry of readTar(tar)) {
    // <repo>-<commit>/templates/compose/<name>.yaml
    const match = entry.name.match(new RegExp(`^[^/]+/${UPSTREAM_PATH}/([^/]+)\\.(ya?ml)$`));
    if (!match) continue;
    files.push({
      upstreamPath: `${UPSTREAM_PATH}/${match[1]}.${match[2]}`,
      id: match[1],
      contents: entry.contents.toString("utf8"),
    });
  }

  if (files.length === 0) {
    throw new Error(
      `No templates found under ${UPSTREAM_PATH} in the pinned tarball. Has the upstream layout changed?`,
    );
  }
  return files;
}

/** Read from a local checkout instead of the network. Used by --offline. */
function readOfflineTemplates(dir: string): SourceFile[] {
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({
      upstreamPath: `${UPSTREAM_PATH}/${name}`,
      id: name.replace(/\.ya?ml$/, ""),
      contents: readFileSync(join(dir, name), "utf8"),
    }));
}

// ---------------------------------------------------------------------------
// Emitted shape
// ---------------------------------------------------------------------------

type VerificationStatus = "passed" | "failed" | "not-verified";

interface EmittedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  documentationUrl: string | null;
  /** Upstream logo path, e.g. "svgs/ghost.svg". Not vendored; see the docs. */
  logo: string | null;
  defaultPort: number | null;
  extraPorts: string | null;
  notices: string[];
  services: ParsedTemplate["services"];
  variables: TemplateVariable[];
  publishable: boolean;
  verification: VerificationStatus;
  warnings: string[];
  upstreamPath: string;
}

function toEmitted(
  parsed: ParsedTemplate,
  upstreamPath: string,
  ledger: VerificationLedger,
): EmittedTemplate {
  const verification: VerificationStatus = ledger.passed.includes(parsed.id)
    ? "passed"
    : parsed.id in ledger.failed
      ? "failed"
      : "not-verified";

  const warnings = [...parsed.warnings];
  if (verification === "failed") {
    warnings.push(`Verification gate failed: ${ledger.failed[parsed.id]}`);
  }

  return {
    id: parsed.id,
    name: parsed.name,
    description: parsed.metadata.slogan ?? "",
    category: parsed.metadata.category ?? "uncategorized",
    tags: parsed.metadata.tags,
    documentationUrl: parsed.metadata.documentation,
    logo: parsed.metadata.logo,
    defaultPort: parsed.metadata.port,
    extraPorts: parsed.metadata.ports,
    notices: parsed.metadata.notices,
    services: parsed.services,
    variables: parsed.variables,
    // Both conditions matter: no warnings AND a recorded pass. A template that
    // parses cleanly but has never been deployed is not publishable.
    publishable: parsed.warnings.length === 0 && verification === "passed",
    verification,
    warnings,
    upstreamPath,
  };
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

const BANNER = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/import-coolify-templates.ts from ${UPSTREAM_REPO}
 * at commit ${UPSTREAM_COMMIT}, path ${UPSTREAM_PATH}/,
 * licensed ${UPSTREAM_LICENSE}. See docs/attribution/coolify.md and NOTICE.
 *
 * SIGNIFICANT CHANGE (Apache-2.0 §4(b)): the upstream Compose bodies use
 * Coolify's magic environment variables, which only Coolify's runtime resolves.
 * They have been translated — declarations rewritten to ordinary \${VAR}
 * interpolation, and the generated/domain values they imply hoisted into the
 * declared \`variables\` list on each template. The Compose bodies here are
 * therefore modified versions of the upstream files, not verbatim copies.
 *
 * Regenerate with: pnpm tsx scripts/import-coolify-templates.ts
 */`;

function generateIndexFile(templates: EmittedTemplate[], ledger: VerificationLedger): string {
  return `${BANNER}

/** Provenance of every template in this file. */
export const COOLIFY_UPSTREAM = {
  repository: ${JSON.stringify(`https://github.com/${UPSTREAM_REPO}`)},
  commit: ${JSON.stringify(UPSTREAM_COMMIT)},
  path: ${JSON.stringify(UPSTREAM_PATH)},
  license: ${JSON.stringify(UPSTREAM_LICENSE)},
  importedAt: ${JSON.stringify(new Date().toISOString().slice(0, 10))},
  verifiedAt: ${JSON.stringify(ledger.verifiedAt)},
} as const;

/** How a generated value is produced. */
export type ServiceTemplateGeneratorKind =
  | "password"
  | "password_with_symbols"
  | "random_string"
  | "base64"
  | "hex"
  | "username"
  | "username_lowercase";

export interface ServiceTemplateGenerator {
  kind: ServiceTemplateGeneratorKind;
  length: number;
}

/** A secret the platform invents; never prompt the user for these. */
export interface ServiceTemplateGeneratedVariable {
  key: string;
  kind: "generated";
  generator: ServiceTemplateGenerator;
  /** Variables sharing an identifier must receive the SAME value. */
  identifier: string;
}

/** A domain the platform assigns to one Compose service. */
export interface ServiceTemplateDomainVariable {
  key: string;
  kind: "domain";
  /** "url" wants scheme://host, "fqdn" wants the bare host. */
  format: "url" | "fqdn";
  /**
   * The free-form label upstream used. NOT reliably a Compose service name —
   * route on \`targetService\` instead.
   */
  serviceName: string;
  port: number | null;
  /** The Compose service to route to. Null only on unpublishable templates. */
  targetService: string | null;
  /** Which rule matched the label to \`targetService\`. */
  resolution: "exact" | "prefix" | "port" | "only-service" | "unresolved";
}

/** Something Coolify can produce and GuildServer cannot yet. */
export interface ServiceTemplateUnsupportedVariable {
  key: string;
  kind: "unsupported";
  command: string;
  reason: string;
}

export type ServiceTemplateVariable =
  | ServiceTemplateGeneratedVariable
  | ServiceTemplateDomainVariable
  | ServiceTemplateUnsupportedVariable;

export interface ServiceTemplateService {
  name: string;
  image: string | null;
  hasHealthcheck: boolean;
  ports: number[];
}

export interface ServiceTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  documentationUrl: string | null;
  /** Upstream logo path, e.g. "svgs/ghost.svg". Assets are not vendored. */
  logo: string | null;
  defaultPort: number | null;
  /** Extra port requirements as upstream wrote them, e.g. "7777 tcp/udp". */
  extraPorts: string | null;
  /** Warnings to show before deploying, from upstream \`# IMPORTANT:\` lines. */
  notices: string[];
  services: ServiceTemplateService[];
  variables: ServiceTemplateVariable[];
  /**
   * True only when the template parses cleanly AND has passed the deployment
   * gate at this upstream commit. Anything the catalogue offers to customers
   * must be filtered on this.
   */
  publishable: boolean;
  verification: "passed" | "failed" | "not-verified";
  warnings: string[];
  upstreamPath: string;
}

/**
 * Every template that could be imported, publishable or not.
 *
 * Compose bodies are NOT here — they are large and the catalogue UI does not
 * need them. Import them from ./service-template-compose.
 */
export const SERVICE_TEMPLATES: ServiceTemplate[] = ${JSON.stringify(templates, null, 2)};

/** Templates cleared for customer use. This is what a catalogue should list. */
export const PUBLISHABLE_SERVICE_TEMPLATES: ServiceTemplate[] = SERVICE_TEMPLATES.filter(
  (template) => template.publishable,
);

export function findServiceTemplate(id: string): ServiceTemplate | undefined {
  return SERVICE_TEMPLATES.find((template) => template.id === id);
}
`;
}

function generateComposeFile(bodies: Record<string, string>): string {
  return `${BANNER}

/**
 * Translated Compose bodies, keyed by template id.
 *
 * Every Coolify declaration has been rewritten to ordinary \`\${VAR}\`
 * interpolation, so a standard Compose engine plus the variable map from
 * ./service-templates is enough to deploy these. Do not feed a body to Docker
 * without first resolving its declared variables — an unresolved
 * SERVICE_PASSWORD_* interpolates to the empty string and the stack starts
 * with no password.
 */
export const SERVICE_TEMPLATE_COMPOSE: Record<string, string> = ${JSON.stringify(bodies, null, 2)};

export function getServiceTemplateCompose(id: string): string | undefined {
  return SERVICE_TEMPLATE_COMPOSE[id];
}
`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ImportSummary {
  fetched: number;
  imported: number;
  skippedIgnored: number;
  unparseable: Record<string, string>;
  publishable: number;
}

export function buildCatalogue(
  sources: SourceFile[],
  ledger: VerificationLedger,
): { templates: EmittedTemplate[]; bodies: Record<string, string>; summary: ImportSummary } {
  const templates: EmittedTemplate[] = [];
  const bodies: Record<string, string> = {};
  const unparseable: Record<string, string> = {};
  let skippedIgnored = 0;

  for (const source of [...sources].sort((a, b) => a.id.localeCompare(b.id))) {
    let parsed: ParsedTemplate;
    try {
      parsed = parseTemplate(source.id, source.contents);
    } catch (error) {
      // A template we cannot represent is left out entirely and recorded.
      // Importing it with an empty body would put a broken entry in front of a
      // customer, which is worse than a smaller catalogue.
      unparseable[source.id] =
        error instanceof TemplateParseError ? error.message : String(error);
      continue;
    }

    // Upstream `# ignore: true` means the template is not ready to ship. Honour
    // that rather than second-guessing the people who maintain it.
    if (parsed.metadata.ignore) {
      skippedIgnored += 1;
      continue;
    }

    templates.push(toEmitted(parsed, source.upstreamPath, ledger));
    bodies[parsed.id] = parsed.compose;
  }

  return {
    templates,
    bodies,
    summary: {
      fetched: sources.length,
      imported: templates.length,
      skippedIgnored,
      unparseable,
      publishable: templates.filter((template) => template.publishable).length,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const offlineIndex = args.indexOf("--offline");
  const offlineDir = offlineIndex >= 0 ? args[offlineIndex + 1] : null;

  const sources = offlineDir
    ? readOfflineTemplates(offlineDir)
    : await fetchUpstreamTemplates();

  const ledger = readLedger();
  const { templates, bodies, summary } = buildCatalogue(sources, ledger);

  console.log("");
  console.log(`Upstream commit   ${UPSTREAM_COMMIT}`);
  console.log(`Files fetched     ${summary.fetched}`);
  console.log(`Imported          ${summary.imported}`);
  console.log(`Skipped (ignore)  ${summary.skippedIgnored}`);
  console.log(`Unparseable       ${Object.keys(summary.unparseable).length}`);
  for (const [id, reason] of Object.entries(summary.unparseable)) {
    console.log(`  - ${id}: ${reason}`);
  }
  console.log(`Publishable       ${summary.publishable}  (parses cleanly AND passed the deploy gate)`);

  const withWarnings = templates.filter((template) => template.warnings.length > 0).length;
  console.log(`With warnings     ${withWarnings}`);
  console.log(`Awaiting gate     ${templates.filter((t) => t.verification === "not-verified").length}`);
  console.log("");

  if (dryRun) {
    console.log("--dry-run: no files written.");
    return;
  }

  for (const [path, contents] of [
    [OUTPUT_INDEX, generateIndexFile(templates, ledger)],
    [OUTPUT_COMPOSE, generateComposeFile(bodies)],
  ] as const) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
    console.log(`Wrote ${path}`);
  }

  // Generated output goes through the repo formatter so a regeneration diff
  // shows content changes, not formatting churn.
  try {
    execFileSync("npx", ["prettier", "--write", OUTPUT_INDEX, OUTPUT_COMPOSE], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  } catch {
    console.warn("⚠ prettier failed; output written unformatted.");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
