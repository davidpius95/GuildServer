#!/usr/bin/env tsx
/**
 * The quality gate for the imported service catalogue.
 *
 *   GS_ALLOW_DOCKER_TESTS=1 pnpm tsx scripts/verify-templates.ts [options]
 *
 * ---------------------------------------------------------------------------
 * Read this before running it
 * ---------------------------------------------------------------------------
 * This script starts containers. Developer and staging hosts for this platform
 * run LIVE CUSTOMER WORKLOADS on the same daemon, so it goes through
 * apps/api/tests/helpers/docker-sandbox.ts, which:
 *
 *   - refuses unless GS_ALLOW_DOCKER_TESTS=1 is set;
 *   - refuses any daemon already hosting `gs.managed=true` containers it does
 *     not own, i.e. any daemon with customer workloads on it;
 *   - labels everything it creates with a unique sandbox id and removes only
 *     what carries that id — no label-prefix sweeps.
 *
 * The intended home for this is a scratch CI runner whose daemon has nothing
 * else on it. On a shared host it refuses and exits non-zero, and THAT IS THE
 * CORRECT OUTCOME — do not reach for GS_DOCKER_TESTS_ACK_SHARED_DAEMON to make
 * it run. That escape hatch exists for a human who has personally confirmed a
 * daemon is disposable, and using it to get a green result would put this
 * script's container churn next to a paying customer's application.
 *
 * ---------------------------------------------------------------------------
 * What passing means
 * ---------------------------------------------------------------------------
 * A template passes when every one of its services starts, and every service
 * that declares a healthcheck reaches `healthy`, within the timeout. Services
 * without a healthcheck must merely still be running at the end — a container
 * that exits 0 immediately is not a working stack.
 *
 * Only templates that pass are marked publishable. Quality over count: 25
 * templates that genuinely deploy beat 371 that half-work.
 *
 * Results are written to scripts/verified-templates.json, stamped with the
 * upstream commit they were produced against. Re-run the importer afterwards to
 * fold them into the catalogue.
 */

import { writeFileSync } from "fs";
import { join, resolve } from "path";

import {
  dockerTestsEnabled,
  SandboxRefused,
  withSandbox,
  type Sandbox,
} from "../apps/api/tests/helpers/docker-sandbox";
import type { TemplateVariable } from "../apps/api/src/services/templates/coolify-template";
import {
  interpolateCompose,
  materializeVariables,
} from "../apps/api/src/services/templates/materialize";
import {
  isGateEligible,
  planServices,
  startOrder,
  toDockerHealthcheck,
  type RunnableService,
} from "../apps/api/src/services/templates/compose-plan";
import {
  SERVICE_TEMPLATES,
  type ServiceTemplate,
} from "../packages/database/src/seed/service-templates";
import { SERVICE_TEMPLATE_COMPOSE } from "../packages/database/src/seed/service-template-compose";

const REPO_ROOT = resolve(__dirname, "..");
const LEDGER_PATH = join(REPO_ROOT, "scripts/verified-templates.json");
const UPSTREAM_COMMIT = "424dbd36fff39a9ccd22efbee019cf490dcf9fc8";

/** How long one template gets to become healthy before it is failed. */
const DEFAULT_TIMEOUT_MS = 300_000;
/** How long an image pull gets. Some of these images are very large. */
const PULL_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

async function pullImage(sandbox: Sandbox, image: string): Promise<void> {
  await new Promise<void>((resolvePull, rejectPull) => {
    const timer = setTimeout(() => rejectPull(new Error(`timed out pulling ${image}`)), PULL_TIMEOUT_MS);
    sandbox.docker.pull(image, {}, (error: Error | null, stream?: NodeJS.ReadableStream) => {
      if (error || !stream) {
        clearTimeout(timer);
        rejectPull(error ?? new Error(`docker pull ${image} returned no stream`));
        return;
      }
      sandbox.docker.modem.followProgress(stream, (progressError: Error | null) => {
        clearTimeout(timer);
        if (progressError) rejectPull(progressError);
        else resolvePull();
      });
    });
  });
}

interface DeployResult {
  ok: boolean;
  reason?: string;
}

async function deployTemplate(
  sandbox: Sandbox,
  services: RunnableService[],
  timeoutMs: number,
): Promise<DeployResult> {
  const deadline = Date.now() + timeoutMs;
  const started: Array<{ service: RunnableService; id: string }> = [];

  for (const service of startOrder(services)) {
    await pullImage(sandbox, service.image);

    const binds: string[] = [];
    for (const volume of service.volumes) {
      const created = await sandbox.createVolume(`${service.name}-${volume.source}`);
      binds.push(`${created}:${volume.target}`);
    }

    const healthcheck = service.healthcheck ? toDockerHealthcheck(service.healthcheck) : undefined;

    const container = await sandbox.createContainer({
      // Unique on the daemon, while the network alias keeps the plain Compose
      // service name resolvable so intra-stack DNS works as the template expects.
      name: `${sandbox.id}-${service.name}`,
      Image: service.image,
      Env: service.env,
      Cmd: typeof service.command === "string" ? ["sh", "-c", service.command] : (service.command ?? undefined),
      Entrypoint: service.entrypoint ?? undefined,
      User: service.user ?? undefined,
      WorkingDir: service.workingDir ?? undefined,
      Healthcheck: healthcheck as never,
      HostConfig: { Binds: binds.length > 0 ? binds : undefined },
      NetworkingConfig: {
        EndpointsConfig: {
          [sandbox.networkName]: {
            // The Compose service name must resolve, and so must any
            // container_name the template's own services connect to.
            Aliases: service.alias ? [service.name, service.alias] : [service.name],
          },
        },
      },
    } as never);

    await container.start();
    started.push({ service, id: container.id });
  }

  // Poll until everything is settled, or the budget runs out.
  while (Date.now() < deadline) {
    const pending: string[] = [];

    for (const { service, id } of started) {
      const info = await sandbox.docker.getContainer(id).inspect();
      const state = info.State;

      if (!state.Running) {
        // A one-shot init container is SUPPOSED to exit — formbricks creates a
        // storage bucket and stops. Only a non-zero exit is a failure there.
        if (service.oneShot) {
          if (state.ExitCode === 0) continue;
          return {
            ok: false,
            reason: `one-shot service "${service.name}" exited with code ${state.ExitCode}`,
          };
        }
        return {
          ok: false,
          reason: `service "${service.name}" exited with code ${state.ExitCode}${
            state.Error ? `: ${state.Error}` : ""
          }`,
        };
      }

      if (service.healthcheck && !service.oneShot) {
        const health = state.Health?.Status;
        if (health === "unhealthy") {
          const last = state.Health?.Log?.slice(-1)[0]?.Output?.trim().slice(0, 200) ?? "";
          return { ok: false, reason: `service "${service.name}" reported unhealthy: ${last}` };
        }
        if (health !== "healthy") pending.push(service.name);
      }
    }

    if (pending.length === 0) {
      // Everything with a healthcheck is healthy. Give the rest a moment to
      // fall over — a container that exits 0 straight away is not a stack.
      await new Promise((r) => setTimeout(r, 5_000));
      for (const { service, id } of started) {
        if (service.oneShot) continue;
        const info = await sandbox.docker.getContainer(id).inspect();
        if (!info.State.Running) {
          return {
            ok: false,
            reason: `service "${service.name}" exited shortly after start (code ${info.State.ExitCode})`,
          };
        }
      }
      return { ok: true };
    }

    await new Promise((r) => setTimeout(r, 3_000));
  }

  return { ok: false, reason: `timed out after ${Math.round(timeoutMs / 1000)}s waiting for health` };
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/**
 * Placeholder for a required user variable.
 *
 * A template that needs a real third-party API key cannot pass this gate no
 * matter what we substitute; the placeholder is here so templates whose
 * required variables are innocuous (a database name, a site title) are not
 * failed for lack of input. Templates that genuinely need a secret fail on
 * their own healthcheck, which is the honest result.
 */
const PLACEHOLDER = "guildserver-verify";

export function selectCandidates(templates: ServiceTemplate[], only?: string[]): ServiceTemplate[] {
  return templates.filter((template) => {
    if (only && only.length > 0 && !only.includes(template.id)) return false;
    return isGateEligible(template);
  });
}

export function prepareCompose(template: ServiceTemplate): string {
  const body = SERVICE_TEMPLATE_COMPOSE[template.id];
  if (!body) throw new Error(`No Compose body vendored for template "${template.id}"`);

  const supplied: Record<string, string> = {};
  for (const variable of template.userVariables) {
    if (variable.required) supplied[variable.key] = PLACEHOLDER;
  }

  const env = materializeVariables(template.variables as TemplateVariable[], {
    // No proxy inside the sandbox, so a domain resolves to the container itself
    // over the sandbox network.
    resolveDomain: (variable) => {
      const host = variable.targetService ?? variable.serviceName;
      const authority = variable.port ? `${host}:${variable.port}` : host;
      return variable.format === "fqdn" ? host : `http://${authority}`;
    },
    userVariables: template.userVariables,
    existing: supplied,
  });

  const { compose, missing } = interpolateCompose(body, env);
  if (missing.length > 0) {
    throw new Error(`unresolved variables after materialization: ${missing.join(", ")}`);
  }
  return compose;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface Options {
  only: string[];
  limit: number | null;
  timeoutMs: number;
  write: boolean;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };
  const only = value("--only");
  const limit = value("--limit");
  const timeout = value("--timeout");

  return {
    only: only ? only.split(",").map((entry) => entry.trim()) : [],
    limit: limit ? Number(limit) : null,
    timeoutMs: timeout ? Number(timeout) * 1000 : DEFAULT_TIMEOUT_MS,
    write: !argv.includes("--no-write"),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  if (!dockerTestsEnabled()) {
    console.error(
      "Refusing to run: GS_ALLOW_DOCKER_TESTS=1 is required.\n\n" +
        "This script starts containers. Set it only on a scratch daemon that hosts nothing else —\n" +
        "never on a host running customer workloads.",
    );
    process.exit(1);
  }

  let candidates = selectCandidates(SERVICE_TEMPLATES, options.only);
  if (options.limit !== null) candidates = candidates.slice(0, options.limit);

  console.log(`${SERVICE_TEMPLATES.length} imported, ${candidates.length} eligible for the gate.\n`);

  const passed: string[] = [];
  const failed: Record<string, string> = {};

  for (const [index, template] of candidates.entries()) {
    const label = `[${index + 1}/${candidates.length}] ${template.id}`;
    let compose: string;
    let services: RunnableService[];

    try {
      compose = prepareCompose(template);
      services = planServices(compose);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed[template.id] = reason;
      console.log(`${label}: SKIP — ${reason}`);
      continue;
    }

    try {
      const result = await withSandbox((sandbox) => deployTemplate(sandbox, services, options.timeoutMs));
      if (result.ok) {
        passed.push(template.id);
        console.log(`${label}: PASS`);
      } else {
        failed[template.id] = result.reason ?? "unknown failure";
        console.log(`${label}: FAIL — ${result.reason}`);
      }
    } catch (error) {
      if (error instanceof SandboxRefused) {
        // The daemon is not disposable. Stop immediately and write nothing:
        // partial results from a refused run are worse than none.
        console.error(`\n${error.message}`);
        process.exit(1);
      }
      const reason = error instanceof Error ? error.message : String(error);
      failed[template.id] = reason;
      console.log(`${label}: ERROR — ${reason}`);
    }
  }

  console.log(`\nPassed ${passed.length}, failed ${Object.keys(failed).length}.`);

  if (!options.write) {
    console.log("--no-write: ledger not updated.");
    return;
  }

  const ledger = {
    upstreamCommit: UPSTREAM_COMMIT,
    verifiedAt: new Date().toISOString(),
    passed: passed.sort(),
    failed: Object.fromEntries(Object.entries(failed).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  console.log(`Wrote ${LEDGER_PATH}`);
  console.log("Re-run scripts/import-coolify-templates.ts to fold these results into the catalogue.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
