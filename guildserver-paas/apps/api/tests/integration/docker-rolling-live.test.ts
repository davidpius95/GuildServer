/**
 * Real-daemon integration test: a rolling deploy must not drop a single request.
 *
 * ⚠️  This test creates and destroys containers on a REAL Docker daemon. It runs
 * only when GS_ALLOW_DOCKER_TESTS=1 AND the daemon hosts no platform-managed
 * containers the sandbox does not own. On any developer or staging host — where
 * live customer applications share the daemon — `withSandbox` refuses and the
 * test fails loudly rather than touching anything. Its home is a scratch CI
 * runner. See tests/helpers/docker-sandbox.ts.
 *
 * It drives `rollingDeploy` directly rather than `deployContainer`, because that
 * lets every container it creates carry the sandbox's unique label and sit on
 * the sandbox's own throwaway network — so cleanup can be exact and Traefik can
 * be constrained to only this sandbox's containers.
 */

jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

import http from 'http';
import Docker from 'dockerode';
import { describeDocker, withSandbox, Sandbox, SANDBOX_LABEL } from '../helpers/docker-sandbox';
import { rollingDeploy } from '../../src/services/docker/rolling';
import { buildTraefikLabels, ContainerSpec } from '../../src/services/docker/primitives';
import { parseHealthCheckConfig } from '../../src/services/docker/deploy-config';

const WHOAMI_IMAGE = 'traefik/whoami:v1.10.1';
const TRAEFIK_IMAGE = 'traefik:v3.0';
const TEST_HOST = 'rolling.sandbox.localhost';

async function pull(d: Docker, image: string): Promise<void> {
  const stream = await d.pull(image);
  await new Promise<void>((resolve, reject) =>
    d.modem.followProgress(stream, (err) => (err ? reject(err) : resolve())),
  );
}

/** Traefik with the docker provider constrained to this sandbox only. */
async function startTraefik(sandbox: Sandbox, hostPort: number): Promise<string> {
  const container = await sandbox.docker.createContainer({
    Image: TRAEFIK_IMAGE,
    name: `traefik-${sandbox.id}`,
    Labels: { ...sandbox.labels },
    Cmd: [
      '--providers.docker=true',
      '--providers.docker.exposedbydefault=false',
      `--providers.docker.network=${sandbox.networkName}`,
      // Traefik must not see, let alone route to, anything outside this sandbox.
      `--providers.docker.constraints=Label(\`${SANDBOX_LABEL}\`,\`${sandbox.id}\`)`,
      '--entrypoints.web.address=:80',
    ],
    ExposedPorts: { '80/tcp': {} },
    HostConfig: {
      PortBindings: { '80/tcp': [{ HostPort: String(hostPort) }] },
      NetworkMode: sandbox.networkName,
      Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
    },
  });
  sandbox.trackContainer(container.id);
  await container.start();
  return container.id;
}

/** Poll until Traefik serves the app, or give up. */
async function waitForRoute(port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await requestOnce(port);
    if (status >= 200 && status < 300) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Traefik never served ${TEST_HOST} on port ${port}`);
}

function requestOnce(port: number): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/', headers: { Host: TEST_HOST }, timeout: 5000, agent: false },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    // 0 stands for "no response at all", which counts as a dropped request.
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

interface LoadResult {
  total: number;
  nonSuccess: number[];
}

/** Hammer the front door until `stop()` is called, recording every status. */
function startLoad(port: number): { stop: () => Promise<LoadResult> } {
  const statuses: number[] = [];
  let running = true;

  const loop = (async () => {
    while (running) {
      statuses.push(await requestOnce(port));
      await new Promise((r) => setTimeout(r, 10));
    }
  })();

  return {
    stop: async () => {
      running = false;
      await loop;
      return { total: statuses.length, nonSuccess: statuses.filter((s) => s < 200 || s >= 300) };
    },
  };
}

function specFor(sandbox: Sandbox, generation: string): ContainerSpec {
  return {
    fullImage: WHOAMI_IMAGE,
    servicePort: 80,
    envArray: [`GENERATION=${generation}`],
    networkName: sandbox.networkName,
  };
}

describeDocker('rolling deploy against a real daemon', () => {
  jest.setTimeout(300000);

  it('serves every request without a single non-2xx across a rolling swap under load', async () => {
    await withSandbox(async (sandbox) => {
      await pull(sandbox.docker, WHOAMI_IMAGE);
      await pull(sandbox.docker, TRAEFIK_IMAGE);

      const appId = `app-${sandbox.id}`;
      const appName = `rolling-${sandbox.id}`;

      // The app's health check, which is also what Traefik's load-balancer
      // health check is derived from — without it a warming backend would join
      // the pool before it can serve, which is precisely the residual gap this
      // test is here to detect.
      const healthConfig = parseHealthCheckConfig({
        health_check_path: '/',
        health_check_interval: 1,
        health_check_timeout: 2,
        health_check_retries: 30,
        health_check_expected_status: '200-299',
      });

      const traefikLabels = buildTraefikLabels({
        appName,
        domains: [TEST_HOST],
        servicePort: 80,
        healthCheck: { path: '/', intervalSeconds: 1, timeoutSeconds: 2 },
        env: {} as NodeJS.ProcessEnv,
      }).labels;

      const appLabels = {
        'gs.managed': 'true',
        'gs.app.id': appId,
        'gs.app.name': appName,
        'gs.project.id': 'sandbox',
        'gs.type': 'application',
        ...sandbox.labels,
      };

      const deploy = (deploymentId: string, generation: string) =>
        rollingDeploy({
          docker: sandbox.docker,
          spec: specFor(sandbox, generation),
          appLabels: { ...appLabels, 'gs.deployment.id': deploymentId },
          traefikLabels,
          applicationId: appId,
          appName,
          deploymentId,
          healthConfig,
          stopGraceSeconds: 5,
          log: () => undefined,
        });

      const proxyPort = 18080 + Math.floor(Math.random() * 1000);
      await startTraefik(sandbox, proxyPort);

      // Generation 1 — the incumbent.
      const first = await deploy('gen1aaaa-0000-0000-0000-000000000001', '1');
      first.retiredContainerIds.forEach((id) => sandbox.trackContainer(id));
      sandbox.trackContainer(first.containerId);
      await waitForRoute(proxyPort);

      // Generation 2 — the rolling swap, under continuous load.
      const load = startLoad(proxyPort);
      const second = await deploy('gen2aaaa-0000-0000-0000-000000000002', '2');
      sandbox.trackContainer(second.containerId);
      // Keep hammering briefly after the swap so a late Traefik reconfiguration
      // that points at the retired container still shows up as a failure.
      await new Promise((r) => setTimeout(r, 3000));
      const result = await load.stop();

      expect(second.mode).toBe('overlap');
      // A meaningful sample, not three requests that happened to land well.
      expect(result.total).toBeGreaterThan(100);
      expect(result.nonSuccess).toEqual([]);
    });
  });

  it('leaves the incumbent serving when the candidate is unhealthy', async () => {
    await withSandbox(async (sandbox) => {
      await pull(sandbox.docker, WHOAMI_IMAGE);
      await pull(sandbox.docker, TRAEFIK_IMAGE);

      const appId = `app-${sandbox.id}`;
      const appName = `failing-${sandbox.id}`;
      const traefikLabels = buildTraefikLabels({
        appName,
        domains: [TEST_HOST],
        servicePort: 80,
        env: {} as NodeJS.ProcessEnv,
      }).labels;
      const appLabels = {
        'gs.managed': 'true',
        'gs.app.id': appId,
        'gs.app.name': appName,
        'gs.project.id': 'sandbox',
        'gs.type': 'application',
        ...sandbox.labels,
      };

      const proxyPort = 19080 + Math.floor(Math.random() * 1000);
      await startTraefik(sandbox, proxyPort);

      const good = await rollingDeploy({
        docker: sandbox.docker,
        spec: specFor(sandbox, '1'),
        appLabels: { ...appLabels, 'gs.deployment.id': 'good' },
        traefikLabels,
        applicationId: appId,
        appName,
        deploymentId: 'gooddddd-0000-0000-0000-000000000001',
        healthConfig: parseHealthCheckConfig({ health_check_path: '/', health_check_retries: 30, health_check_interval: 1 }),
        stopGraceSeconds: 5,
        log: () => undefined,
      });
      sandbox.trackContainer(good.containerId);
      await waitForRoute(proxyPort);

      // A candidate that can never pass: probe a port nothing listens on.
      const load = startLoad(proxyPort);
      const failure = await rollingDeploy({
        docker: sandbox.docker,
        spec: specFor(sandbox, '2'),
        appLabels: { ...appLabels, 'gs.deployment.id': 'bad' },
        traefikLabels,
        applicationId: appId,
        appName,
        deploymentId: 'badddddd-0000-0000-0000-000000000002',
        healthConfig: parseHealthCheckConfig({
          health_check_path: '/',
          health_check_port: 9999,
          health_check_retries: 2,
          health_check_interval: 1,
          health_check_timeout: 1,
        }),
        stopGraceSeconds: 5,
        log: () => undefined,
      }).catch((e) => e);
      const result = await load.stop();

      expect(failure).toBeInstanceOf(Error);
      expect(failure.name).toBe('CandidateFailedError');
      expect(failure.incumbentPreserved).toBe(true);

      // The failed deploy was a no-op: not one request was dropped.
      expect(result.nonSuccess).toEqual([]);

      // And the incumbent is still there, running.
      const still = await sandbox.docker.getContainer(good.containerId).inspect();
      expect(still.State.Running).toBe(true);
    });
  });
});
