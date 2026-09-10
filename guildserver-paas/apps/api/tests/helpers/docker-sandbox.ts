/**
 * Guarded access to a real Docker daemon for integration tests.
 *
 * ⚠️  READ THIS BEFORE WRITING A TEST THAT TOUCHES DOCKER ⚠️
 *
 * Developer and staging hosts for this platform run LIVE CUSTOMER WORKLOADS on
 * the same daemon the test suite can reach. A test that lists containers by
 * `gs.*` label and cleans up "leftovers" will happily delete a paying
 * customer's application. So real-daemon tests are:
 *
 *   1. OFF by default. They run only when GS_ALLOW_DOCKER_TESTS=1.
 *   2. REFUSED when the daemon already hosts platform-managed containers this
 *      sandbox did not create. A daemon with customer workloads on it is not a
 *      scratch daemon, and the suite says so and skips rather than guessing.
 *   3. Scoped. Everything a sandbox creates carries a unique
 *      `gs.test.sandbox=<id>` label, and cleanup only ever removes containers,
 *      networks and volumes carrying THAT id. No label-prefix sweeps.
 *
 * The intended home for these tests is a scratch CI runner whose daemon has
 * nothing else on it. On a shared host the guard refuses, the suite skips, and
 * that refusal is itself covered by a unit test — see docker-sandbox-guard.test.ts.
 *
 * GS_DOCKER_TESTS_ACK_SHARED_DAEMON=1 overrides the refusal in (2). Do not set
 * it. It exists so that a human who has personally confirmed a daemon is
 * disposable can say so explicitly; it is not a way to get a red suite green.
 */

import Docker from "dockerode";
import { randomBytes } from "crypto";

export const SANDBOX_LABEL = "gs.test.sandbox";
export const ALLOW_ENV = "GS_ALLOW_DOCKER_TESTS";
export const ACK_SHARED_DAEMON_ENV = "GS_DOCKER_TESTS_ACK_SHARED_DAEMON";

/** Labels that mark a container as belonging to the platform, i.e. possibly a customer's. */
const MANAGED_LABEL = "gs.managed";

export function dockerTestsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_ENV] === "1";
}

export class SandboxRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxRefused";
  }
}

/**
 * Refuse the daemon if it is hosting platform-managed containers that are not
 * ours.
 *
 * `sandboxId` is null during the pre-flight check (nothing of ours exists yet),
 * so at that point ANY `gs.managed=true` container means the daemon is shared.
 */
export async function assertSandboxSafe(
  dockerClient: Pick<Docker, "listContainers">,
  options?: { sandboxId?: string | null; env?: NodeJS.ProcessEnv },
): Promise<void> {
  const env = options?.env ?? process.env;
  const containers = await dockerClient.listContainers({
    all: true,
    filters: { label: [`${MANAGED_LABEL}=true`] },
  });

  const foreign = containers.filter((c) => {
    const labels = c.Labels || {};
    return !options?.sandboxId || labels[SANDBOX_LABEL] !== options.sandboxId;
  });

  if (foreign.length === 0) return;

  if (env[ACK_SHARED_DAEMON_ENV] === "1") return;

  const names = foreign
    .slice(0, 5)
    .map((c) => c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12))
    .join(", ");

  throw new SandboxRefused(
    `Refusing to run Docker integration tests: this daemon hosts ${foreign.length} ` +
      `platform-managed container(s) that the sandbox does not own (${names}` +
      `${foreign.length > 5 ? ", …" : ""}). These may be live customer workloads. ` +
      `Run these tests on a scratch daemon instead.`,
  );
}

export interface Sandbox {
  id: string;
  docker: Docker;
  /** Label pair every resource this sandbox creates must carry. */
  labels: Record<string, string>;
  /** Name of the throwaway bridge network created for this sandbox. */
  networkName: string;
  /** Register a resource so cleanup removes it even if a test throws mid-way. */
  trackContainer(id: string): void;
  trackVolume(name: string): void;
  /**
   * Create a container with the sandbox label and network forced on.
   *
   * Prefer this over calling docker.createContainer directly: the label is what
   * makes cleanup safe, and applying it here means a test cannot forget it.
   */
  createContainer(opts: Docker.ContainerCreateOptions): Promise<Docker.Container>;
  /** Create a named volume with the sandbox label forced on. */
  createVolume(name: string): Promise<string>;
}

async function cleanupSandbox(sandbox: Sandbox, tracked: { containers: Set<string>; volumes: Set<string> }) {
  const d = sandbox.docker;

  // Only ever remove what carries THIS sandbox's id. Never a label-prefix sweep.
  const owned = await d
    .listContainers({ all: true, filters: { label: [`${SANDBOX_LABEL}=${sandbox.id}`] } })
    .catch(() => []);

  for (const id of new Set([...tracked.containers, ...owned.map((c) => c.Id)])) {
    await d.getContainer(id).remove({ force: true }).catch(() => undefined);
  }
  for (const name of tracked.volumes) {
    await d.getVolume(name).remove({ force: true } as any).catch(() => undefined);
  }
  await d.getNetwork(sandbox.networkName).remove().catch(() => undefined);
}

/**
 * Run `fn` against a freshly created, uniquely labelled sandbox on the real
 * daemon, then remove everything the sandbox created.
 *
 * Throws `SandboxRefused` if the daemon is not disposable. Callers inside
 * `describeDocker` never see that, because the block is skipped first.
 */
const liveSandboxes = new Set<() => Promise<void>>();
let reaperInstalled = false;

function installReaper(): void {
  if (reaperInstalled) return;
  reaperInstalled = true;
  const reap = () => {
    for (const cleanup of liveSandboxes) void cleanup();
  };
  process.once("exit", reap);
  process.once("SIGINT", reap);
  process.once("SIGTERM", reap);
}

export async function withSandbox<T>(fn: (sandbox: Sandbox) => Promise<T>): Promise<T> {
  if (!dockerTestsEnabled()) {
    throw new SandboxRefused(`${ALLOW_ENV}=1 is required to run Docker integration tests.`);
  }

  const docker = new Docker({
    socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
  });

  await assertSandboxSafe(docker, { sandboxId: null });

  const id = `sbx-${randomBytes(6).toString("hex")}`;
  const networkName = `gs-test-${id}`;
  const labels = { [SANDBOX_LABEL]: id };
  const tracked = { containers: new Set<string>(), volumes: new Set<string>() };

  await docker.createNetwork({ Name: networkName, Labels: labels });

  const sandbox: Sandbox = {
    id,
    docker,
    labels,
    networkName,
    trackContainer: (cid) => tracked.containers.add(cid),
    trackVolume: (name) => tracked.volumes.add(name),

    async createContainer(opts: Docker.ContainerCreateOptions) {
      // Sandbox labels are merged last so a test cannot overwrite them.
      const container = await docker.createContainer({
        ...opts,
        Labels: { ...(opts.Labels ?? {}), ...labels },
        HostConfig: { ...(opts.HostConfig ?? {}), NetworkMode: networkName },
      });
      tracked.containers.add(container.id);
      return container;
    },

    async createVolume(name: string) {
      const fullName = `${networkName}-${name}`;
      await docker.createVolume({ Name: fullName, Labels: labels });
      tracked.volumes.add(fullName);
      return fullName;
    },
  };

  const cleanup = () => cleanupSandbox(sandbox, tracked);
  installReaper();
  liveSandboxes.add(cleanup);

  try {
    return await fn(sandbox);
  } finally {
    await cleanup();
    liveSandboxes.delete(cleanup);
  }
}

/**
 * `describe` that skips unless real-daemon tests are explicitly enabled.
 *
 * The daemon-is-shared refusal is deliberately NOT checked here — it happens
 * inside `withSandbox`, at which point a shared daemon fails the test loudly
 * rather than quietly skipping. Enabling the tests on a host with customer
 * workloads should be noisy.
 */
export function describeDocker(name: string, fn: () => void): void {
  if (dockerTestsEnabled()) {
    describe(name, fn);
  } else {
    describe.skip(`${name} [skipped: set ${ALLOW_ENV}=1 on a scratch daemon]`, fn);
  }
}
