/**
 * Configurable health checks, exercised against a real local HTTP server on a
 * loopback port. No Docker daemon involved — the dockerode client is a stub that
 * only answers `inspect`.
 */

jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

import http from 'http';
import { AddressInfo } from 'net';
import { runConfiguredHealthCheck, checkContainerHealth } from '../../src/services/docker/health';
import { parseHealthCheckConfig } from '../../src/services/docker/deploy-config';

/**
 * A dockerode stub reporting a running container with no network IP, so the
 * probe targets 127.0.0.1 on the published host port.
 */
function stubDocker(state: { running?: boolean; exitCode?: number } = {}) {
  return {
    getContainer: () => ({
      inspect: async () => ({
        Id: 'c1',
        State: { Running: state.running ?? true, Status: state.running === false ? 'exited' : 'running', ExitCode: state.exitCode ?? 0 },
        NetworkSettings: { Networks: {}, Ports: {} },
      }),
    }),
  } as any;
}

async function withServer(
  handler: http.RequestListener,
  fn: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('runConfiguredHealthCheck', () => {
  it('passes on the configured path with a 200', async () => {
    const config = parseHealthCheckConfig({ health_check_path: '/healthz', health_check_retries: 1 })!;
    const seen: string[] = [];

    await withServer(
      (req, res) => {
        seen.push(req.url!);
        res.writeHead(200).end('ok');
      },
      async (port) => {
        const result = await runConfiguredHealthCheck({
          containerId: 'c1',
          hostPort: port,
          expectedContainerPort: 3000,
          config,
          dockerClient: stubDocker(),
        });
        expect(result.healthy).toBe(true);
        expect(result.protocol).toBe('http');
      },
    );

    // The configured path, not `/`.
    expect(seen).toEqual(['/healthz']);
  }, 20000);

  it('accepts a 401 when expected_status says so', async () => {
    // An authenticated app answering 401 on its health path has demonstrably booted.
    const config = parseHealthCheckConfig({
      health_check_path: '/healthz',
      health_check_expected_status: '200-299,401',
      health_check_retries: 1,
    })!;

    await withServer(
      (_req, res) => res.writeHead(401).end(),
      async (port) => {
        const result = await runConfiguredHealthCheck({
          containerId: 'c1',
          hostPort: port,
          expectedContainerPort: 3000,
          config,
          dockerClient: stubDocker(),
        });
        expect(result.healthy).toBe(true);
        expect(result.message).toContain('401');
      },
    );
  }, 20000);

  it('fails a status outside the accepted set, after exhausting retries', async () => {
    const config = parseHealthCheckConfig({
      health_check_path: '/healthz',
      health_check_expected_status: '200-299',
      health_check_retries: 2,
      health_check_interval: 1,
    })!;
    let hits = 0;

    await withServer(
      (_req, res) => {
        hits++;
        res.writeHead(503).end();
      },
      async (port) => {
        const result = await runConfiguredHealthCheck({
          containerId: 'c1',
          hostPort: port,
          expectedContainerPort: 3000,
          config,
          dockerClient: stubDocker(),
        });
        expect(result.healthy).toBe(false);
        expect(result.message).toContain('503');
      },
    );

    // retries=2 means 3 attempts.
    expect(hits).toBe(3);
  }, 20000);

  it('recovers when the app becomes healthy on a later attempt', async () => {
    const config = parseHealthCheckConfig({
      health_check_path: '/healthz',
      health_check_retries: 5,
      health_check_interval: 1,
    })!;
    let hits = 0;

    await withServer(
      (_req, res) => {
        hits++;
        res.writeHead(hits < 3 ? 503 : 200).end();
      },
      async (port) => {
        const result = await runConfiguredHealthCheck({
          containerId: 'c1',
          hostPort: port,
          expectedContainerPort: 3000,
          config,
          dockerClient: stubDocker(),
        });
        expect(result.healthy).toBe(true);
      },
    );
    expect(hits).toBe(3);
  }, 20000);

  it('fails immediately when the container has exited rather than waiting out the window', async () => {
    const config = parseHealthCheckConfig({
      health_check_path: '/healthz',
      health_check_retries: 10,
      health_check_interval: 30,
    })!;

    const started = Date.now();
    const result = await runConfiguredHealthCheck({
      containerId: 'c1',
      // Nothing is listening here.
      hostPort: 1,
      expectedContainerPort: 3000,
      config,
      dockerClient: stubDocker({ running: false, exitCode: 137 }),
    });

    expect(result.healthy).toBe(false);
    expect(result.message).toContain('exited');
    expect(result.message).toContain('137');
    // A dead container is not worth 10 * 30s of waiting.
    expect(Date.now() - started).toBeLessThan(10000);
  }, 20000);

  it('honours the start period before the first probe', async () => {
    const config = parseHealthCheckConfig({
      health_check_path: '/healthz',
      health_check_start_period: 2,
      health_check_retries: 1,
    })!;
    const started = Date.now();

    await withServer(
      (_req, res) => res.writeHead(200).end(),
      async (port) => {
        const result = await runConfiguredHealthCheck({
          containerId: 'c1',
          hostPort: port,
          expectedContainerPort: 3000,
          config,
          dockerClient: stubDocker(),
        });
        expect(result.healthy).toBe(true);
      },
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  }, 20000);
});

describe('checkContainerHealth — NULL config means the legacy probe, unchanged', () => {
  it('uses the legacy reachability probe, which GETs "/" and reports its own message', async () => {
    // NULL health_check_path — i.e. every application row today — must behave
    // exactly as it did before this feature existed. The distinguishing
    // evidence: the legacy probe requests "/" and answers with its own wording,
    // where the configured probe would request the configured path.
    const seen: string[] = [];

    await withServer(
      (req, res) => {
        seen.push(req.url!);
        res.writeHead(200).end();
      },
      async (port) => {
        const result = await checkContainerHealth({
          containerId: 'c1',
          hostPort: port,
          expectedContainerPort: 3000,
          config: parseHealthCheckConfig({ health_check_path: null }),
          dockerClient: stubDocker(),
        });
        expect(result.healthy).toBe(true);
        expect(result.message).toBe('Service is responding');
      },
    );

    expect(seen).toEqual(['/']);
  }, 20000);

  it('reports the legacy timeout wording when nothing is listening', async () => {
    const result = await checkContainerHealth({
      containerId: 'c1',
      hostPort: 1,
      expectedContainerPort: 3000,
      config: null,
      maxWaitMs: 100,
      dockerClient: stubDocker(),
    });
    expect(result.healthy).toBe(false);
    expect(result.message).toContain('Service unreachable after');
  }, 20000);

  it('uses the configured probe when a config is present', async () => {
    const config = parseHealthCheckConfig({ health_check_path: '/healthz', health_check_retries: 1 })!;
    const seen: string[] = [];

    await withServer(
      (req, res) => {
        seen.push(req.url!);
        res.writeHead(200).end();
      },
      async (port) => {
        const result = await checkContainerHealth({
          containerId: 'c1',
          hostPort: port,
          expectedContainerPort: 3000,
          config,
          dockerClient: stubDocker(),
        });
        expect(result.healthy).toBe(true);
        expect(result.message).toContain('/healthz');
      },
    );

    expect(seen).toEqual(['/healthz']);
  }, 20000);
});
