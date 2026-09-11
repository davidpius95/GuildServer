import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("http", () => ({
  get: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../src/websocket/server", () => ({
  broadcastToUser: jest.fn(),
}));

jest.mock("../../src/services/docker/client", () => ({
  docker: {
    getContainer: jest.fn(),
  },
}));

import http from "http";
import { postDeployHealthCheck, runConfiguredHealthCheck } from "../../src/services/docker/health";

describe("postDeployHealthCheck", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fails fast when the container exposes a different port than expected", async () => {
    const inspect = jest.fn().mockResolvedValue({
      State: { Running: true, ExitCode: 0 },
      NetworkSettings: {
        Networks: {
          bridge: { IPAddress: "172.17.0.5" },
        },
        Ports: {
          "8080/tcp": [{ HostPort: "32768" }],
        },
      },
    });

    (http.get as jest.Mock).mockImplementation((_options, _callback) => {
      const req: any = {
        on: jest.fn((event: string, handler: (...args: any[]) => void) => {
          if (event === "error") {
            handler(new Error("connect ECONNREFUSED"));
          }
          return req;
        }),
        destroy: jest.fn(),
      };
      return req;
    });

    const result = await postDeployHealthCheck({
      containerId: "container-1",
      hostPort: 32768,
      expectedContainerPort: 3000,
      dockerClient: {
        getContainer: jest.fn().mockReturnValue({ inspect }),
      } as any,
      maxWaitMs: 10_000,
    });

    expect(result.healthy).toBe(false);
    expect(result.portMismatch).toEqual({ expected: 3000, actual: 8080 });
    expect((http.get as jest.Mock).mock.calls).toHaveLength(1);
  });
});

describe("health checks for containers on a remote Docker host", () => {
  // The container's bridge IP (172.18.0.9) is only reachable on the remote
  // host itself; the control plane must probe the host's address on the
  // published port instead.
  const remoteDaemon = () => {
    const inspect = jest.fn().mockResolvedValue({
      State: { Running: true, ExitCode: 0 },
      NetworkSettings: { Networks: { guildserver: { IPAddress: "172.18.0.9" } }, Ports: { "80/tcp": [{ HostPort: "30001" }] } },
    });
    return { getContainer: jest.fn(() => ({ inspect })) } as any;
  };

  const answerOnly = (hostname: string, port: number) => {
    (http.get as jest.Mock).mockImplementation((options: any, callback: any) => {
      const req: any = { on: jest.fn(() => req), destroy: jest.fn() };
      if (options.hostname === hostname && options.port === port) {
        setImmediate(() => callback({ statusCode: 200, resume: jest.fn(), on: jest.fn() }));
      } else {
        req.on = jest.fn((event: string, handler: (...args: any[]) => void) => {
          if (event === "error") setImmediate(() => handler(new Error("EHOSTUNREACH")));
          return req;
        });
      }
      return req;
    });
  };

  beforeEach(() => jest.clearAllMocks());

  it("postDeployHealthCheck probes the remote host on the host port", async () => {
    answerOnly("203.0.113.5", 30001);
    const result = await postDeployHealthCheck({
      containerId: "c1",
      hostPort: 30001,
      expectedContainerPort: 80,
      dockerClient: remoteDaemon(),
      probeHost: "203.0.113.5",
      maxWaitMs: 2000,
    });
    expect(result.healthy).toBe(true);
    const [options] = (http.get as jest.Mock).mock.calls[0] as any[];
    expect(options).toMatchObject({ hostname: "203.0.113.5", port: 30001 });
  });

  it("runConfiguredHealthCheck probes the remote host on the host port", async () => {
    answerOnly("203.0.113.5", 30001);
    const result = await runConfiguredHealthCheck({
      containerId: "c1",
      hostPort: 30001,
      expectedContainerPort: 80,
      config: {
        path: "/healthz",
        intervalSeconds: 1,
        timeoutSeconds: 1,
        retries: 0,
        startPeriodSeconds: 0,
        expectedStatus: "200",
        matchesStatus: (status: number) => status === 200,
      },
      dockerClient: remoteDaemon(),
      probeHost: "203.0.113.5",
      maxWaitMs: 2000,
    });
    expect(result.healthy).toBe(true);
    const [options] = (http.get as jest.Mock).mock.calls[0] as any[];
    expect(options).toMatchObject({ hostname: "203.0.113.5", port: 30001 });
  });
});

