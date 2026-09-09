/**
 * Tests for the sandbox guard itself.
 *
 * These run on every `pnpm test` and never touch Docker — the point is to prove
 * the guard refuses before a daemon is ever contacted.
 */

import {
  SandboxRefusedError,
  assertDaemonIsSafe,
  dockerTestsEnabled,
  withSandbox,
  TEST_OWNED_LABEL,
} from "./docker-sandbox";

describe("docker sandbox guard", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("opt-in gate", () => {
    it("reports disabled when GS_ALLOW_DOCKER_TESTS is unset", () => {
      delete process.env.GS_ALLOW_DOCKER_TESTS;
      expect(dockerTestsEnabled()).toBe(false);
    });

    it("reports disabled for values other than exactly '1'", () => {
      for (const value of ["0", "true", "yes", ""]) {
        process.env.GS_ALLOW_DOCKER_TESTS = value;
        expect(dockerTestsEnabled()).toBe(false);
      }
    });

    it("refuses to build a sandbox — without contacting Docker — when disabled", async () => {
      delete process.env.GS_ALLOW_DOCKER_TESTS;
      const body = jest.fn();

      await expect(withSandbox(body)).rejects.toThrow(SandboxRefusedError);
      // The critical assertion: the body never ran, so no Docker call happened.
      expect(body).not.toHaveBeenCalled();
    });
  });

  describe("shared-daemon detection", () => {
    const fakeDocker = (containers: any[]) =>
      ({ listContainers: jest.fn().mockResolvedValue(containers) }) as any;

    it("allows a daemon with no GuildServer-managed containers", async () => {
      await expect(assertDaemonIsSafe(fakeDocker([]))).resolves.toBeUndefined();
    });

    it("allows a daemon whose managed containers are all sandbox-owned", async () => {
      const docker = fakeDocker([
        { Id: "abc", Names: ["/gs-test-1"], Labels: { "gs.managed": "true", [TEST_OWNED_LABEL]: "true" } },
      ]);
      await expect(assertDaemonIsSafe(docker)).resolves.toBeUndefined();
    });

    it("refuses a daemon hosting live managed containers", async () => {
      const docker = fakeDocker([
        { Id: "abc", Names: ["/gs-daily-habit-tracker-app"], Labels: { "gs.managed": "true" } },
      ]);
      await expect(assertDaemonIsSafe(docker)).rejects.toThrow(SandboxRefusedError);
      await expect(assertDaemonIsSafe(docker)).rejects.toThrow(/live install/);
    });

    it("names the containers it is protecting so the refusal is actionable", async () => {
      const docker = fakeDocker([
        { Id: "abc", Names: ["/gs-daily-habit-tracker-app"], Labels: { "gs.managed": "true" } },
      ]);
      await expect(assertDaemonIsSafe(docker)).rejects.toThrow(/gs-daily-habit-tracker-app/);
    });

    it("allows an acknowledged shared daemon", async () => {
      process.env.GS_DOCKER_TESTS_ACK_SHARED_DAEMON = "1";
      const docker = fakeDocker([
        { Id: "abc", Names: ["/gs-live"], Labels: { "gs.managed": "true" } },
      ]);
      await expect(assertDaemonIsSafe(docker)).resolves.toBeUndefined();
    });

    it("only counts GuildServer-managed containers", async () => {
      // Unmanaged containers on the host are none of our business, and must not
      // be enough on their own to block a legitimate test run.
      const docker = fakeDocker([]);
      await assertDaemonIsSafe(docker);
      expect(docker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: ["gs.managed=true"] },
      });
    });
  });
});
