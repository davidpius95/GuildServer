/**
 * Deploying, reconciling and tearing down Compose stacks.
 *
 * ## Why the CLI and not dockerode
 *
 * Everything else in this codebase talks to the daemon through dockerode, and
 * that is right for a single container. A stack is not a single container: it
 * is a dependency graph with start ordering, condition-gated `depends_on`,
 * network creation and attachment, volume creation, and orphan removal on
 * redeploy. `docker compose` implements all of that, is the reference
 * implementation of the file format we accept, and is what the user tested
 * their file against locally. Reimplementing it on dockerode would mean owning
 * a second, subtly different Compose engine — and every difference would show
 * up as "it works on my machine but not on GuildServer".
 *
 * So: the CLI runs the graph, dockerode reads the result back. Reads stay on
 * dockerode because parsing `docker ps` output is worse than an API call.
 *
 * ## Safety
 *
 * Every destructive operation here is scoped two ways: by `--project-name`, and
 * by a `gs.service.id=<uuid>` label filter. Neither is a name-prefix sweep.
 * `removeStack` in particular refuses to delete any volume that is not recorded
 * in `service_volumes` as managed by this stack.
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type Docker from "dockerode";
import { eq, and } from "drizzle-orm";
import { db, services, serviceContainers, serviceVolumes } from "@guildserver/database";
import { logger } from "../../utils/logger";
import { broadcastToUser } from "../../websocket/server";
import { docker as defaultDocker, GS_LABELS } from "../docker/client";
import { normalizeCompose, NormalizeResult } from "./normalize";

/** Where rendered Compose files live. One directory per stack. */
export function stackDirectory(serviceId: string): string {
  const root = process.env.GS_SERVICE_DIR || path.join(os.tmpdir(), "guildserver-services");
  return path.join(root, serviceId);
}

export interface ComposeCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunComposeOptions {
  project: string;
  file: string;
  cwd: string;
  args: string[];
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run one `docker compose` invocation.
 *
 * Arguments are passed as an array to `spawn` with no shell, so a stack name or
 * domain containing shell metacharacters is inert. There is no code path here
 * that builds a command string.
 */
export function runCompose(options: RunComposeOptions): Promise<ComposeCommandResult> {
  const argv = ["compose", "--project-name", options.project, "--file", options.file, ...options.args];

  return new Promise((resolve, reject) => {
    const child = spawn("docker", argv, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`docker compose ${options.args[0]} timed out after ${options.timeoutMs ?? 600_000}ms`));
      },
      options.timeoutMs ?? 600_000,
    );

    const pump = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (!options.onLine) return;
      for (const line of text.split("\n")) {
        const trimmed = line.trimEnd();
        if (trimmed) options.onLine(trimmed, stream);
      }
    };

    child.stdout?.on("data", pump("stdout"));
    child.stderr?.on("data", pump("stderr"));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("The `docker` CLI is not available on this host, so Compose stacks cannot be deployed.")
          : error,
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

export interface DeployStackOptions {
  serviceId: string;
  deploymentId?: string | null;
  userId?: string | null;
  /** Injected in tests. */
  database?: typeof db;
  dockerClient?: Pick<Docker, "listContainers" | "getVolume" | "listVolumes">;
  runner?: typeof runCompose;
  now?: () => Date;
}

export interface DeployStackResult {
  project: string;
  composeResolved: string;
  containers: ReconciledContainer[];
  status: "running" | "degraded" | "failed";
  logs: string[];
}

export async function deployStack(options: DeployStackOptions): Promise<DeployStackResult> {
  const database = options.database ?? db;
  const run = options.runner ?? runCompose;
  const logs: string[] = [];

  const log = (message: string, phase = "deploy") => {
    logs.push(message);
    logger.info(`[stack ${options.serviceId}] ${message}`);
    if (options.userId && options.deploymentId) {
      broadcastToUser(options.userId, {
        type: "deployment_log",
        deploymentId: options.deploymentId,
        log: message,
        phase,
      });
    }
  };

  const phase = (name: string, status: string, message: string) => {
    if (!options.userId || !options.deploymentId) return;
    broadcastToUser(options.userId, {
      type: "deployment_phase",
      deploymentId: options.deploymentId,
      phase: name,
      status,
      message,
      timestamp: new Date().toISOString(),
    });
  };

  const service = await database.query.services.findFirst({ where: eq(services.id, options.serviceId) });
  if (!service) throw new Error(`Stack ${options.serviceId} not found`);

  phase("validate", "running", "Validating Compose file...");

  const normalized: NormalizeResult = normalizeCompose({
    service: {
      id: service.id,
      serviceName: service.serviceName,
      projectId: service.projectId,
      environment: (service.environment as Record<string, string>) ?? {},
      domains: (service.domains as Record<string, string[]>) ?? {},
    },
    composeFile: service.composeFile,
    deploymentId: options.deploymentId,
  });

  normalized.notes.forEach((note) => log(note, "validate"));
  log(
    `Stack resolves to ${normalized.services.length} container(s) under project ${normalized.project}`,
    "validate",
  );
  phase("validate", "success", "Compose file is valid");

  // Credentials invented for SERVICE_* placeholders must be persisted before we
  // deploy, not after. If the deploy dies half way, a redeploy has to reuse the
  // same password — a Postgres volume initialised with the first password does
  // not accept the second, and the failure surfaces as an unexplained crash
  // loop long after the deploy that caused it.
  if (Object.keys(normalized.generatedEnvironment).length > 0) {
    await database
      .update(services)
      .set({
        environment: { ...((service.environment as Record<string, string>) ?? {}), ...normalized.generatedEnvironment },
        updatedAt: new Date(),
      })
      .where(eq(services.id, service.id));
  }

  await database
    .update(services)
    .set({ status: "deploying", composeResolved: normalized.composeResolved, updatedAt: new Date() })
    .where(eq(services.id, service.id));

  await recordVolumes(database, service.id, normalized);

  const dir = stackDirectory(service.id);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "docker-compose.yaml");
  await fs.writeFile(file, normalized.composeResolved, { mode: 0o600 });

  phase("deploy", "running", "Starting containers...");

  try {
    const pull = await run({
      project: normalized.project,
      file,
      cwd: dir,
      args: ["pull", "--ignore-pull-failures"],
      onLine: (line) => log(line, "pull"),
    });
    if (pull.code !== 0) {
      // Non-fatal: `up` pulls what it needs anyway, and a private image with no
      // credentials configured here should fail at `up` with a better message.
      log("Image pre-pull reported errors; continuing — `up` will pull what it needs.", "pull");
    }

    const up = await run({
      project: normalized.project,
      file,
      cwd: dir,
      // --remove-orphans deletes containers that belong to THIS project but are
      // no longer in the file (a service the user removed). It is scoped by
      // project name and cannot reach another stack.
      args: ["up", "--detach", "--remove-orphans", "--wait", "--wait-timeout", "300"],
      onLine: (line) => log(line, "deploy"),
    });

    if (up.code !== 0) {
      await database
        .update(services)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(services.id, service.id));
      await reconcileContainers({
        serviceId: service.id,
        database,
        dockerClient: options.dockerClient,
        expected: normalized.services.map((s) => s.composeServiceName),
        now: options.now,
      });
      const detail = (up.stderr || up.stdout).trim().split("\n").slice(-5).join("\n");
      throw new Error(`docker compose up failed (exit ${up.code}).${detail ? `\n${detail}` : ""}`);
    }
  } catch (error) {
    phase("deploy", "failed", error instanceof Error ? error.message : String(error));
    await database
      .update(services)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(services.id, service.id));
    throw error;
  }

  const containers = await reconcileContainers({
    serviceId: service.id,
    database,
    dockerClient: options.dockerClient,
    expected: normalized.services.map((s) => s.composeServiceName),
    now: options.now,
  });

  const status = aggregateStatus(containers);
  await database.update(services).set({ status, updatedAt: new Date() }).where(eq(services.id, service.id));

  for (const c of containers) {
    log(`${c.composeServiceName}: ${c.status}${c.health ? ` (${c.health})` : ""}`, "reconcile");
  }
  phase("deploy", status === "running" ? "success" : "failed", `Stack is ${status}`);

  return { project: normalized.project, composeResolved: normalized.composeResolved, containers, status, logs };
}

/**
 * A stack is only "running" when every container we expect is up.
 *
 * "Two of five containers are unhealthy" is the state a single status column
 * cannot express, which is why per-container rows exist; `degraded` is the
 * honest summary and the dashboard drills in from there.
 */
export function aggregateStatus(containers: ReconciledContainer[]): "running" | "degraded" | "failed" {
  if (containers.length === 0) return "failed";
  const bad = containers.filter((c) => c.status !== "running" || c.health === "unhealthy");
  if (bad.length === 0) return "running";
  if (bad.length === containers.length) return "failed";
  return "degraded";
}

async function recordVolumes(database: typeof db, serviceId: string, normalized: NormalizeResult): Promise<void> {
  const existing = await database.select().from(serviceVolumes).where(eq(serviceVolumes.serviceId, serviceId));
  const known = new Set(existing.map((v) => v.composeVolumeName));

  const toInsert = normalized.volumes.filter((v) => !known.has(v.composeVolumeName));
  if (toInsert.length > 0) {
    await database.insert(serviceVolumes).values(
      toInsert.map((v) => ({
        serviceId,
        composeVolumeName: v.composeVolumeName,
        volumeName: v.volumeName,
        managed: v.managed,
      })),
    );
  }

  // A volume the user removed from the file stays recorded. Docker will not
  // have deleted it either, and forgetting it here is how a volume with a
  // customer's data becomes an untracked orphan nobody ever reclaims.
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconciledContainer {
  composeServiceName: string;
  containerId: string | null;
  containerName: string | null;
  image: string | null;
  status: string;
  health: string | null;
  hostPort: number | null;
  containerPort: number | null;
}

export interface ReconcileOptions {
  serviceId: string;
  database?: typeof db;
  dockerClient?: Pick<Docker, "listContainers">;
  /** Compose service names the current file declares. */
  expected?: string[];
  now?: () => Date;
}

/**
 * Read the daemon back into `service_containers`.
 *
 * The important case is the one that is easy to get wrong: a container that
 * exists in our table but is no longer on the daemon. Deleting the row makes
 * the stack look like it never had that service; leaving the row untouched
 * makes a vanished container look healthy forever. It is marked `missing`
 * instead, with `containerId` cleared, so the UI can say "postgres is gone"
 * rather than quietly dropping it from the list.
 */
export async function reconcileContainers(options: ReconcileOptions): Promise<ReconciledContainer[]> {
  const database = options.database ?? db;
  const client = options.dockerClient ?? defaultDocker;
  const now = (options.now ?? (() => new Date()))();

  // Label-filtered, never name-prefixed. This filter is the reason a stack
  // cannot see, and therefore cannot act on, another stack's containers.
  const live = await client.listContainers({
    all: true,
    filters: { label: [`${GS_LABELS.SERVICE_ID}=${options.serviceId}`] },
  });

  const byComposeName = new Map<string, ReconciledContainer>();
  for (const c of live) {
    const labels = c.Labels || {};
    const composeServiceName = labels[GS_LABELS.COMPOSE_SERVICE];
    if (!composeServiceName) continue;

    const port = (c.Ports || []).find((p) => p.PublicPort);
    byComposeName.set(composeServiceName, {
      composeServiceName,
      containerId: c.Id,
      containerName: c.Names?.[0]?.replace(/^\//, "") ?? null,
      image: c.Image ?? null,
      status: c.State ?? "unknown",
      health: extractHealth(c.Status),
      hostPort: port?.PublicPort ?? null,
      containerPort: port?.PrivatePort ?? null,
    });
  }

  const rows = await database
    .select()
    .from(serviceContainers)
    .where(eq(serviceContainers.serviceId, options.serviceId));
  const rowByName = new Map(rows.map((r) => [r.composeServiceName, r]));

  const names = new Set<string>([
    ...byComposeName.keys(),
    ...rowByName.keys(),
    ...(options.expected ?? []),
  ]);

  const result: ReconciledContainer[] = [];

  for (const name of names) {
    const seen = byComposeName.get(name);
    const row = rowByName.get(name);

    const state: ReconciledContainer = seen ?? {
      composeServiceName: name,
      // Keep the last known name and image so the UI can still say WHAT went
      // missing, but drop the container id: it no longer refers to anything,
      // and a stale id is what makes a later `docker stop` hit a recycled one.
      containerId: null,
      containerName: row?.containerName ?? null,
      image: row?.image ?? null,
      status: row ? "missing" : "pending",
      health: null,
      hostPort: null,
      containerPort: null,
    };

    if (row) {
      await database
        .update(serviceContainers)
        .set({
          containerId: state.containerId,
          containerName: state.containerName,
          image: state.image,
          status: state.status,
          health: state.health,
          hostPort: state.hostPort,
          containerPort: state.containerPort,
          lastSeenAt: seen ? now : row.lastSeenAt,
          updatedAt: now,
        })
        .where(eq(serviceContainers.id, row.id));
    } else {
      await database.insert(serviceContainers).values({
        serviceId: options.serviceId,
        composeServiceName: name,
        containerId: state.containerId,
        containerName: state.containerName,
        image: state.image,
        status: state.status,
        health: state.health,
        hostPort: state.hostPort,
        containerPort: state.containerPort,
        lastSeenAt: seen ? now : null,
      });
    }

    result.push(state);
  }

  return result.sort((a, b) => a.composeServiceName.localeCompare(b.composeServiceName));
}

/** Docker reports health inside the human-readable status: "Up 2 minutes (healthy)". */
export function extractHealth(status: string | undefined): string | null {
  if (!status) return null;
  const m = /\((healthy|unhealthy|health: starting|starting)\)/i.exec(status);
  if (!m) return null;
  const value = m[1].toLowerCase();
  return value === "health: starting" ? "starting" : value;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface StackLifecycleOptions {
  serviceId: string;
  database?: typeof db;
  runner?: typeof runCompose;
  dockerClient?: Pick<Docker, "listContainers" | "getVolume">;
  userId?: string | null;
}

async function withStackFile<T>(
  serviceId: string,
  database: typeof db,
  fn: (ctx: { project: string; file: string; cwd: string; service: any }) => Promise<T>,
): Promise<T> {
  const service = await database.query.services.findFirst({ where: eq(services.id, serviceId) });
  if (!service) throw new Error(`Stack ${serviceId} not found`);

  const normalized = normalizeCompose({
    service: {
      id: service.id,
      serviceName: service.serviceName,
      projectId: service.projectId,
      environment: (service.environment as Record<string, string>) ?? {},
      domains: (service.domains as Record<string, string[]>) ?? {},
    },
    composeFile: service.composeFile,
  });

  const cwd = stackDirectory(serviceId);
  await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
  const file = path.join(cwd, "docker-compose.yaml");
  // Re-render rather than trusting whatever is on disk: the file may be from an
  // older process, another replica, or a wiped tmpdir.
  await fs.writeFile(file, service.composeResolved || normalized.composeResolved, { mode: 0o600 });

  return fn({ project: normalized.project, file, cwd, service });
}

export async function stopStack(options: StackLifecycleOptions): Promise<ComposeCommandResult> {
  const database = options.database ?? db;
  const run = options.runner ?? runCompose;

  const result = await withStackFile(options.serviceId, database, ({ project, file, cwd }) =>
    run({ project, file, cwd, args: ["stop"] }),
  );

  await database
    .update(services)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(eq(services.id, options.serviceId));
  await reconcileContainers({
    serviceId: options.serviceId,
    database,
    dockerClient: options.dockerClient,
  });
  return result;
}

export async function restartStack(options: StackLifecycleOptions): Promise<ComposeCommandResult> {
  const database = options.database ?? db;
  const run = options.runner ?? runCompose;

  const result = await withStackFile(options.serviceId, database, ({ project, file, cwd }) =>
    run({ project, file, cwd, args: ["restart"] }),
  );

  const containers = await reconcileContainers({
    serviceId: options.serviceId,
    database,
    dockerClient: options.dockerClient,
  });
  await database
    .update(services)
    .set({ status: aggregateStatus(containers), updatedAt: new Date() })
    .where(eq(services.id, options.serviceId));
  return result;
}

export interface RemoveStackResult {
  /** Volume names actually removed. */
  removedVolumes: string[];
  /** Volumes we own but could not remove, with the reason. */
  failedVolumes: { name: string; reason: string }[];
  /** Container ids removed by the label-filtered sweep after `down`. */
  sweptContainers: string[];
}

/**
 * Tear a stack down.
 *
 * Three passes, in this order, and the order matters:
 *
 *   1. `docker compose down` scoped to the project name. Removes the stack's
 *      containers and its own networks. Deliberately WITHOUT `--volumes`: the
 *      CLI's idea of which volumes belong to the project is derived from name
 *      prefixes, and we are not willing to delete data on that basis.
 *   2. A label-filtered sweep for `gs.service.id=<uuid>` containers the CLI
 *      missed — a container renamed out of the project, or one left behind by a
 *      crashed deploy. The filter is a UUID equality test, so it is incapable
 *      of matching another stack.
 *   3. Volumes, one at a time, ONLY those recorded in `service_volumes` for
 *      this stack with `managed = true`. Never a listing, never a prefix match.
 *
 * The combination is what makes "delete removes exactly this stack's resources"
 * a property rather than a hope.
 */
export async function removeStack(
  options: StackLifecycleOptions & { removeVolumes?: boolean },
): Promise<RemoveStackResult> {
  const database = options.database ?? db;
  const run = options.runner ?? runCompose;
  const client = (options.dockerClient ?? defaultDocker) as Pick<Docker, "listContainers" | "getVolume"> & {
    getContainer?: (id: string) => any;
  };

  const result: RemoveStackResult = { removedVolumes: [], failedVolumes: [], sweptContainers: [] };

  // ---- 1. Project-scoped down -------------------------------------------
  try {
    await withStackFile(options.serviceId, database, ({ project, file, cwd }) =>
      run({ project, file, cwd, args: ["down", "--remove-orphans"] }),
    );
  } catch (error) {
    // A stack whose Compose file no longer normalises (the user broke it, or a
    // rule tightened) must still be deletable. Pass 2 does not need the file.
    logger.warn(`[stack ${options.serviceId}] compose down failed, falling back to label sweep: ${String(error)}`);
  }

  // ---- 2. Label-filtered container sweep ---------------------------------
  const strays = await client.listContainers({
    all: true,
    filters: { label: [`${GS_LABELS.SERVICE_ID}=${options.serviceId}`] },
  });
  for (const c of strays) {
    // Belt and braces: never act on a container whose label does not literally
    // equal this stack's id, whatever the daemon's filter did.
    if ((c.Labels || {})[GS_LABELS.SERVICE_ID] !== options.serviceId) continue;
    try {
      await (client as any).getContainer(c.Id).remove({ force: true });
      result.sweptContainers.push(c.Id);
    } catch (error) {
      logger.warn(`[stack ${options.serviceId}] could not remove stray container ${c.Id}: ${String(error)}`);
    }
  }

  // ---- 3. Recorded, managed volumes only ---------------------------------
  if (options.removeVolumes) {
    const owned = await database
      .select()
      .from(serviceVolumes)
      .where(and(eq(serviceVolumes.serviceId, options.serviceId), eq(serviceVolumes.managed, true)));

    for (const volume of owned) {
      try {
        await (client as any).getVolume(volume.volumeName).remove({ force: true });
        result.removedVolumes.push(volume.volumeName);
      } catch (error: any) {
        if (error?.statusCode === 404) {
          result.removedVolumes.push(volume.volumeName);
          continue;
        }
        result.failedVolumes.push({ name: volume.volumeName, reason: error?.message || String(error) });
      }
    }
  }

  await fs.rm(stackDirectory(options.serviceId), { recursive: true, force: true }).catch(() => undefined);

  return result;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export interface StackLogsOptions {
  serviceId: string;
  /** Omit for the whole stack. */
  composeServiceName?: string;
  tail?: number;
  database?: typeof db;
  runner?: typeof runCompose;
}

export async function getStackLogs(options: StackLogsOptions): Promise<string[]> {
  const database = options.database ?? db;
  const run = options.runner ?? runCompose;
  const tail = Math.min(Math.max(options.tail ?? 200, 1), 5000);

  const result = await withStackFile(options.serviceId, database, ({ project, file, cwd }) =>
    run({
      project,
      file,
      cwd,
      args: [
        "logs",
        "--no-color",
        "--timestamps",
        "--tail",
        String(tail),
        ...(options.composeServiceName ? [options.composeServiceName] : []),
      ],
      timeoutMs: 60_000,
    }),
  );

  return `${result.stdout}\n${result.stderr}`.split("\n").filter((l) => l.trim().length > 0);
}
