/**
 * Docker integration-test sandbox.
 *
 * GuildServer's control plane and its customers' workloads can share a Docker
 * daemon — on a single-node install they always do. Our own production code
 * reaps containers by label (`gs.managed=true`, `gs.app.id=<id>`), so an
 * integration test that reuses those helpers carelessly will happily stop a
 * paying customer's application.
 *
 * Every real-daemon test goes through `withSandbox`, which enforces four rules:
 *
 *   1. Opt-in only. Without GS_ALLOW_DOCKER_TESTS=1 nothing touches Docker.
 *   2. Every resource the sandbox creates carries `gs.test-run=<runId>`.
 *   3. Every destructive call is filtered by that run label, so a test can only
 *      ever destroy what it created.
 *   4. Teardown reaps by run label, and a process-exit reaper catches crashes.
 *
 * Rule 3 is the important one. Tests may not call `docker.getContainer(id)`
 * directly on an id they did not create; use the handles the sandbox returns.
 */

import Docker from "dockerode";
import { randomUUID } from "crypto";

/** Label marking every resource owned by one sandbox run. */
export const TEST_RUN_LABEL = "gs.test-run";

/** Label marking a resource as sandbox-owned regardless of run. */
export const TEST_OWNED_LABEL = "gs.test-owned";

export class SandboxRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxRefusedError";
  }
}

export function dockerTestsEnabled(): boolean {
  return process.env.GS_ALLOW_DOCKER_TESTS === "1";
}

/**
 * Refuse to run against a daemon that is hosting real workloads unless the
 * caller has explicitly acknowledged it.
 *
 * A developer machine and the production single-node install look identical to
 * dockerode. The difference we can observe is whether managed, non-test
 * containers are already running. If they are, this is somebody's live install
 * and we require GS_DOCKER_TESTS_ACK_SHARED_DAEMON=1 on top of the normal
 * opt-in — two deliberate acts, not one.
 */
export async function assertDaemonIsSafe(docker: Docker): Promise<void> {
  const managed = await docker.listContainers({
    all: true,
    filters: { label: ["gs.managed=true"] },
  });

  const live = managed.filter((c) => !c.Labels?.[TEST_OWNED_LABEL]);
  if (live.length === 0) return;

  if (process.env.GS_DOCKER_TESTS_ACK_SHARED_DAEMON === "1") return;

  const names = live.slice(0, 5).map((c) => c.Names?.[0] ?? c.Id.slice(0, 12));
  throw new SandboxRefusedError(
    `Refusing to run Docker integration tests: this daemon is hosting ${live.length} ` +
      `GuildServer-managed container(s) that the sandbox does not own ` +
      `(e.g. ${names.join(", ")}). This looks like a live install. ` +
      `Run these tests on a scratch daemon, or set ` +
      `GS_DOCKER_TESTS_ACK_SHARED_DAEMON=1 if you are certain.`,
  );
}

export interface Sandbox {
  /** Unique id for this run; also the value of the gs.test-run label. */
  readonly runId: string;
  /** Dedicated bridge network for this run. */
  readonly networkName: string;
  readonly docker: Docker;
  /** Labels every sandbox-created resource must carry. */
  labels(extra?: Record<string, string>): Record<string, string>;
  /** Create a container inside the sandbox. Labels are forced. */
  createContainer(opts: Docker.ContainerCreateOptions): Promise<Docker.Container>;
  /** Create a named volume inside the sandbox. */
  createVolume(name: string): Promise<string>;
  /** Prefix a name so it is recognisably sandbox-owned. */
  name(suffix: string): string;
  /** Remove every resource this run created. Safe to call repeatedly. */
  cleanup(): Promise<void>;
}

class SandboxImpl implements Sandbox {
  readonly runId: string;
  readonly networkName: string;
  readonly docker: Docker;
  private network?: Docker.Network;
  private readonly containers = new Set<string>();
  private readonly volumes = new Set<string>();
  private cleanedUp = false;

  constructor(docker: Docker, runId: string) {
    this.docker = docker;
    this.runId = runId;
    this.networkName = `gs-test-${runId}`;
  }

  labels(extra: Record<string, string> = {}): Record<string, string> {
    return { ...extra, [TEST_RUN_LABEL]: this.runId, [TEST_OWNED_LABEL]: "true" };
  }

  name(suffix: string): string {
    return `gs-test-${this.runId}-${suffix}`;
  }

  async setup(): Promise<void> {
    this.network = await this.docker.createNetwork({
      Name: this.networkName,
      Driver: "bridge",
      Labels: this.labels(),
    });
  }

  async createContainer(opts: Docker.ContainerCreateOptions): Promise<Docker.Container> {
    // Sandbox labels are applied last so a test cannot overwrite them.
    const merged: Docker.ContainerCreateOptions = {
      ...opts,
      name: opts.name ?? this.name(randomUUID().slice(0, 8)),
      Labels: this.labels(opts.Labels ?? {}),
      HostConfig: { ...(opts.HostConfig ?? {}), NetworkMode: this.networkName },
    };
    const container = await this.docker.createContainer(merged);
    this.containers.add(container.id);
    return container;
  }

  async createVolume(name: string): Promise<string> {
    const fullName = this.name(name);
    await this.docker.createVolume({ Name: fullName, Labels: this.labels() });
    this.volumes.add(fullName);
    return fullName;
  }

  async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    // Reap by label rather than by the tracked ids, so containers a test
    // created through a code path we do not control are still caught.
    const filters = { label: [`${TEST_RUN_LABEL}=${this.runId}`] };

    const containers = await this.docker
      .listContainers({ all: true, filters })
      .catch(() => [] as Docker.ContainerInfo[]);

    for (const info of containers) {
      // Belt and braces: never remove something lacking our run label.
      if (info.Labels?.[TEST_RUN_LABEL] !== this.runId) continue;
      try {
        await this.docker.getContainer(info.Id).remove({ force: true, v: true });
      } catch {
        // Already gone, or gone while we were iterating.
      }
    }

    for (const volumeName of this.volumes) {
      try {
        await this.docker.getVolume(volumeName).remove({ force: true } as any);
      } catch {
        // Already gone.
      }
    }

    try {
      await (this.network ?? this.docker.getNetwork(this.networkName)).remove();
    } catch {
      // Already gone.
    }
  }
}

const activeSandboxes = new Set<SandboxImpl>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const reap = () => {
    for (const sandbox of activeSandboxes) {
      // Best-effort synchronous-ish reap; the label filter keeps it safe.
      void sandbox.cleanup();
    }
  };
  process.once("exit", reap);
  process.once("SIGINT", reap);
  process.once("SIGTERM", reap);
}

/**
 * Run `fn` with a fresh sandbox, tearing it down afterwards even on failure.
 *
 * Throws SandboxRefusedError — rather than silently skipping — when Docker
 * tests are not enabled, so a suite cannot pass by accident. Use
 * `describeDocker` to skip cleanly instead.
 */
export async function withSandbox<T>(fn: (sandbox: Sandbox) => Promise<T>): Promise<T> {
  if (!dockerTestsEnabled()) {
    throw new SandboxRefusedError(
      "Docker integration tests are disabled. Set GS_ALLOW_DOCKER_TESTS=1 to enable them.",
    );
  }

  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  await assertDaemonIsSafe(docker);

  const sandbox = new SandboxImpl(docker, randomUUID().slice(0, 12));
  installExitHook();
  activeSandboxes.add(sandbox);

  try {
    await sandbox.setup();
    return await fn(sandbox);
  } finally {
    await sandbox.cleanup();
    activeSandboxes.delete(sandbox);
  }
}

/**
 * `describe` that skips when Docker tests are not enabled, so the default
 * `pnpm test` run stays green and daemon-free.
 */
export const describeDocker: jest.Describe = (dockerTestsEnabled()
  ? describe
  : describe.skip) as jest.Describe;
