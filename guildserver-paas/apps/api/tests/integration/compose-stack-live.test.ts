/**
 * Real-daemon integration test: deploy, redeploy and delete a three-service
 * Compose stack.
 *
 * ⚠️  This test creates and destroys containers, networks and volumes on a REAL
 * Docker daemon. It runs only when GS_ALLOW_DOCKER_TESTS=1 AND the daemon hosts
 * no platform-managed containers the sandbox does not own. On any developer or
 * staging host — where live customer applications share the daemon —
 * `withSandbox` refuses and the test fails loudly rather than touching
 * anything. Its home is a scratch CI runner. See tests/helpers/docker-sandbox.ts.
 *
 * Every container this test creates carries the sandbox label, because the
 * stack's Compose file sets it as a user label and normalisation preserves user
 * labels it does not own. That is what lets the sandbox's exact, label-scoped
 * cleanup reach containers that `docker compose` — not dockerode — created.
 */

jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

import http from 'http';
import Docker from 'dockerode';
import { eq } from 'drizzle-orm';
import { services, serviceContainers, serviceVolumes } from '@guildserver/database';
import { db, testUtils } from '../setup';
import {
  describeDocker,
  withSandbox,
  Sandbox,
  SANDBOX_LABEL,
  SandboxRefused,
  dockerTestsEnabled,
} from '../helpers/docker-sandbox';
import { deployStack, removeStack, reconcileContainers, runCompose } from '../../src/services/compose/deploy';
import { normalizeCompose } from '../../src/services/compose/normalize';
import { GS_LABELS, NETWORK_NAME } from '../../src/services/docker/client';

const TRAEFIK_IMAGE = 'traefik:v3.0';
const WEB_IMAGE = 'traefik/whoami:v1.10.1';
const POSTGRES_IMAGE = 'postgres:16-alpine';
const REDIS_IMAGE = 'redis:7-alpine';
const TEST_HOST = 'stack.sandbox.localhost';

jest.setTimeout(600_000);

/**
 * The refusal path, checked on every host including this one.
 *
 * This is the assertion that makes the guard load-bearing rather than
 * decorative: if someone deletes the env-var check, this test starts touching a
 * real daemon and this expectation fails first.
 */
describe('compose stack integration guard', () => {
  it('refuses to touch a daemon unless real-daemon tests were explicitly enabled', async () => {
    if (dockerTestsEnabled()) {
      // On a scratch runner the gate is open; the `describeDocker` block below
      // is the test.
      expect(dockerTestsEnabled()).toBe(true);
      return;
    }
    await expect(withSandbox(async () => undefined)).rejects.toBeInstanceOf(SandboxRefused);
    await expect(withSandbox(async () => undefined)).rejects.toThrow(/GS_ALLOW_DOCKER_TESTS=1 is required/);
  });
});

function composeFileFor(sandboxId: string): string {
  return `
services:
  web:
    image: ${WEB_IMAGE}
    expose: ["80"]
    depends_on:
      - postgres
      - redis
    labels:
      ${SANDBOX_LABEL}: "${sandboxId}"
  postgres:
    image: ${POSTGRES_IMAGE}
    environment:
      POSTGRES_PASSWORD: \${SERVICE_PASSWORD_POSTGRES}
      POSTGRES_DB: appdb
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 3s
      timeout: 3s
      retries: 20
    labels:
      ${SANDBOX_LABEL}: "${sandboxId}"
  redis:
    image: ${REDIS_IMAGE}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 20
    labels:
      ${SANDBOX_LABEL}: "${sandboxId}"
volumes:
  pgdata:
`;
}

async function pull(d: Docker, image: string): Promise<void> {
  const stream = await d.pull(image);
  await new Promise<void>((resolve, reject) => d.modem.followProgress(stream, (err) => (err ? reject(err) : resolve())));
}

/** Run a command inside a container and return its combined output. */
async function execInContainer(d: Docker, containerId: string, cmd: string[]): Promise<string> {
  const exec = await d.getContainer(containerId).exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true, stdin: false });
  return new Promise((resolve, reject) => {
    let out = '';
    stream.on('data', (chunk: Buffer) => {
      // Demultiplex the 8-byte docker stream header.
      out += chunk.length > 8 ? chunk.subarray(8).toString('utf8') : chunk.toString('utf8');
    });
    stream.on('end', () => resolve(out));
    stream.on('error', reject);
  });
}

function httpGet(port: number, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'GET', headers: { Host: host }, timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value != null) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${String(last)}` : ''}`);
}

describeDocker('Compose stacks against a real daemon', () => {
  it('deploys a web + postgres + redis stack, keeps data across a redeploy, and deletes only its own resources', async () => {
    await withSandbox(async (sandbox: Sandbox) => {
      const d = sandbox.docker;

      for (const image of [TRAEFIK_IMAGE, WEB_IMAGE, POSTGRES_IMAGE, REDIS_IMAGE]) {
        await pull(d, image);
      }

      // The shared proxy network is external in production; create it here with
      // the sandbox label so cleanup can reclaim it.
      const proxyNetwork = await d
        .createNetwork({ Name: NETWORK_NAME, Labels: { ...sandbox.labels } })
        .catch(async (error: any) => {
          if (error?.statusCode === 409) return d.getNetwork(NETWORK_NAME);
          throw error;
        });

      // ---- The stack under test ------------------------------------------
      const { project } = await testUtils.createTestSetup();
      const [stack] = await db
        .insert(services)
        .values({
          name: 'Sandbox Stack',
          serviceName: `sandbox-${sandbox.id.slice(4)}`,
          projectId: project.id,
          composeFile: composeFileFor(sandbox.id),
          environment: {},
          domains: { web: [TEST_HOST] },
        } as any)
        .returning();

      const expectedProject = normalizeCompose({
        service: { id: stack.id, serviceName: stack.serviceName, environment: {}, domains: {} },
        composeFile: composeFileFor(sandbox.id),
      }).project;
      // Track the volume up front so a mid-test failure still cleans it up.
      sandbox.trackVolume(`${expectedProject}_pgdata`);

      // ---- A foreign stack and a foreign application, which must survive ---
      const [foreignStack] = await db
        .insert(services)
        .values({
          name: 'Foreign Stack',
          serviceName: `foreign-${sandbox.id.slice(4)}`,
          projectId: project.id,
          composeFile: composeFileFor(sandbox.id),
          environment: {},
          domains: {},
        } as any)
        .returning();

      const foreignContainer = await sandbox.createContainer({
        Image: REDIS_IMAGE,
        name: `foreign-${sandbox.id}`,
        Labels: {
          [GS_LABELS.MANAGED]: 'true',
          [GS_LABELS.TYPE]: 'service',
          // A different stack's id: the value the delete filter must not match.
          [GS_LABELS.SERVICE_ID]: foreignStack.id,
          [GS_LABELS.COMPOSE_SERVICE]: 'redis',
        },
      });
      await foreignContainer.start();

      const foreignVolume = await sandbox.createVolume('foreign-data');
      await db.insert(serviceVolumes).values([
        { serviceId: foreignStack.id, composeVolumeName: 'foreign-data', volumeName: foreignVolume, managed: true },
      ] as any);

      let traefikId: string | null = null;

      try {
        // ---- Deploy ------------------------------------------------------
        const first = await deployStack({ serviceId: stack.id, database: db });

        expect(first.project).toBe(expectedProject);
        expect(first.status).toBe('running');
        expect(first.containers.map((c) => c.composeServiceName).sort()).toEqual(['postgres', 'redis', 'web']);
        expect(first.containers.every((c) => c.status === 'running')).toBe(true);

        // Healthchecks are declared on postgres and redis, so both must report
        // healthy rather than merely running.
        const healthy = await waitFor('postgres and redis to become healthy', async () => {
          const current = await reconcileContainers({ serviceId: stack.id, database: db });
          const gated = current.filter((c) => c.composeServiceName !== 'web');
          return gated.every((c) => c.health === 'healthy') ? current : null;
        });
        expect(healthy.filter((c) => c.health === 'healthy')).toHaveLength(2);

        // The generated Postgres password was persisted, so a redeploy reuses it.
        const [afterDeploy] = await db.select().from(services).where(eq(services.id, stack.id));
        const generatedPassword = (afterDeploy.environment as any).SERVICE_PASSWORD_POSTGRES;
        expect(typeof generatedPassword).toBe('string');
        expect(generatedPassword).toHaveLength(32);
        expect(afterDeploy.status).toBe('running');

        // Namespacing actually landed on the daemon.
        const rows = await db.select().from(serviceContainers).where(eq(serviceContainers.serviceId, stack.id));
        for (const row of rows) {
          expect(row.containerName).toBe(`${expectedProject}-${row.composeServiceName}`);
        }
        const volumeRows = await db.select().from(serviceVolumes).where(eq(serviceVolumes.serviceId, stack.id));
        expect(volumeRows.map((v) => v.volumeName)).toEqual([`${expectedProject}_pgdata`]);
        await expect(d.getVolume(`${expectedProject}_pgdata`).inspect()).resolves.toBeDefined();

        // ---- Reachable through Traefik ------------------------------------
        const traefikPort = 18000 + Math.floor(Math.random() * 1000);
        const traefik = await sandbox.createContainer({
          Image: TRAEFIK_IMAGE,
          name: `traefik-${sandbox.id}`,
          Labels: { ...sandbox.labels },
          Cmd: [
            '--providers.docker=true',
            '--providers.docker.exposedbydefault=false',
            `--providers.docker.network=${NETWORK_NAME}`,
            // Traefik must not see anything outside this sandbox.
            `--providers.docker.constraints=Label(\`${SANDBOX_LABEL}\`,\`${sandbox.id}\`)`,
            '--entrypoints.web.address=:80',
          ],
          ExposedPorts: { '80/tcp': {} },
          HostConfig: {
            PortBindings: { '80/tcp': [{ HostPort: String(traefikPort) }] },
            Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
          },
        });
        traefikId = traefik.id;
        await traefik.start();
        // Join the proxy network the stack's web service is on.
        await (proxyNetwork as any).connect({ Container: traefik.id });

        const response = await waitFor(`${TEST_HOST} to answer through Traefik`, async () => {
          const res = await httpGet(traefikPort, TEST_HOST);
          return res.status === 200 ? res : null;
        });
        expect(response.status).toBe(200);
        expect(response.body).toContain('Hostname:');

        // ---- Data survives a redeploy --------------------------------------
        const postgresRow = rows.find((r) => r.composeServiceName === 'postgres')!;
        await execInContainer(d, postgresRow.containerId!, [
          'psql',
          '-U',
          'postgres',
          '-d',
          'appdb',
          '-c',
          'CREATE TABLE survives (id int); INSERT INTO survives VALUES (42);',
        ]);

        const second = await deployStack({ serviceId: stack.id, database: db });
        expect(second.status).toBe('running');
        expect(second.project).toBe(expectedProject);

        const afterRedeploy = await db
          .select()
          .from(serviceContainers)
          .where(eq(serviceContainers.serviceId, stack.id));
        const newPostgres = afterRedeploy.find((r) => r.composeServiceName === 'postgres')!;

        const query = await waitFor('the redeployed database to answer', async () => {
          const out = await execInContainer(d, newPostgres.containerId!, [
            'psql',
            '-U',
            'postgres',
            '-d',
            'appdb',
            '-tAc',
            'SELECT id FROM survives',
          ]);
          return out.includes('42') ? out : null;
        });
        expect(query).toContain('42');

        // The volume was reused rather than recreated.
        const volumesAfter = await db.select().from(serviceVolumes).where(eq(serviceVolumes.serviceId, stack.id));
        expect(volumesAfter).toHaveLength(1);
        expect(volumesAfter[0].volumeName).toBe(`${expectedProject}_pgdata`);

        // The password was not regenerated on the second pass.
        const [afterSecond] = await db.select().from(services).where(eq(services.id, stack.id));
        expect((afterSecond.environment as any).SERVICE_PASSWORD_POSTGRES).toBe(generatedPassword);

        // ---- Delete removes exactly this stack -----------------------------
        const result = await removeStack({ serviceId: stack.id, removeVolumes: true, database: db });
        expect(result.failedVolumes).toEqual([]);
        expect(result.removedVolumes).toEqual([`${expectedProject}_pgdata`]);

        const stackContainersLeft = await d.listContainers({
          all: true,
          filters: { label: [`${GS_LABELS.SERVICE_ID}=${stack.id}`] },
        });
        expect(stackContainersLeft).toHaveLength(0);

        await expect(d.getVolume(`${expectedProject}_pgdata`).inspect()).rejects.toMatchObject({ statusCode: 404 });

        // ...and left every foreign resource untouched.
        const foreignLeft = await d.listContainers({
          all: true,
          filters: { label: [`${GS_LABELS.SERVICE_ID}=${foreignStack.id}`] },
        });
        expect(foreignLeft.map((c) => c.Id)).toEqual([foreignContainer.id]);
        expect((await d.getContainer(foreignContainer.id).inspect()).State.Running).toBe(true);
        await expect(d.getVolume(foreignVolume).inspect()).resolves.toBeDefined();

        // The Traefik container is not a stack resource and must also survive.
        expect((await d.getContainer(traefik.id).inspect()).State.Running).toBe(true);
      } finally {
        // Belt and braces on top of the sandbox's own cleanup: bring the
        // compose project down so its network goes with it.
        const dir = process.env.GS_SERVICE_DIR;
        await runCompose({
          project: expectedProject,
          file: `${dir ?? '/tmp/guildserver-services'}/${stack.id}/docker-compose.yaml`,
          cwd: process.cwd(),
          args: ['down', '--remove-orphans'],
          timeoutMs: 120_000,
        }).catch(() => undefined);
        if (traefikId) {
          await d.getContainer(traefikId).remove({ force: true }).catch(() => undefined);
        }
        await d.getNetwork(NETWORK_NAME).remove().catch(() => undefined);
      }
    });
  });
});
