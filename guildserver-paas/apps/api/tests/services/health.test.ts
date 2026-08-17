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
import { postDeployHealthCheck } from "../../src/services/docker/health";

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
