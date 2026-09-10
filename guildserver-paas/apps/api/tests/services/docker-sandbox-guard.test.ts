/**
 * The Docker test sandbox's SAFETY GUARD.
 *
 * This is the test that keeps the integration tests from deleting a customer's
 * application. It exercises the refusal path directly, with an injected fake
 * daemon listing, so it runs everywhere and never touches /var/run/docker.sock.
 */

import {
  ALLOW_ENV,
  ACK_SHARED_DAEMON_ENV,
  SANDBOX_LABEL,
  SandboxRefused,
  assertSandboxSafe,
  describeDocker,
  dockerTestsEnabled,
  withSandbox,
} from '../helpers/docker-sandbox';

function fakeDaemon(containers: Array<{ Id: string; Names?: string[]; Labels?: Record<string, string> }>) {
  return {
    listContainers: jest.fn().mockResolvedValue(containers),
  } as any;
}

describe('dockerTestsEnabled', () => {
  it('is off unless explicitly enabled', () => {
    expect(dockerTestsEnabled({})).toBe(false);
    expect(dockerTestsEnabled({ [ALLOW_ENV]: '0' })).toBe(false);
    expect(dockerTestsEnabled({ [ALLOW_ENV]: 'true' })).toBe(false);
    expect(dockerTestsEnabled({ [ALLOW_ENV]: '1' })).toBe(true);
  });
});

describe('withSandbox refusal happens before any Docker call', () => {
  it('does not invoke the test body when the opt-in is absent', async () => {
    const prev = process.env[ALLOW_ENV];
    delete process.env[ALLOW_ENV];
    const body = jest.fn();
    try {
      await expect(withSandbox(body)).rejects.toBeInstanceOf(SandboxRefused);
      // The load-bearing assertion: refusing early means no daemon contact.
      expect(body).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env[ALLOW_ENV] = prev;
    }
  });
});

describe('assertSandboxSafe', () => {
  it('allows a daemon with no platform-managed containers', async () => {
    await expect(assertSandboxSafe(fakeDaemon([]), { env: {} })).resolves.toBeUndefined();
  });

  it('REFUSES a daemon hosting platform-managed containers it does not own', async () => {
    // This is the situation on every developer and staging host: real customer
    // applications on the same daemon the test suite can reach.
    const daemon = fakeDaemon([
      { Id: 'a'.repeat(64), Names: ['/gs-daily-habit-tracker-app'], Labels: { 'gs.managed': 'true' } },
      { Id: 'b'.repeat(64), Names: ['/guildpay-api'], Labels: { 'gs.managed': 'true' } },
    ]);

    await expect(assertSandboxSafe(daemon, { env: {} })).rejects.toBeInstanceOf(SandboxRefused);
    await expect(assertSandboxSafe(daemon, { env: {} })).rejects.toThrow(/live customer workloads/i);
    // The refusal names what it found, so the operator can see why.
    await expect(assertSandboxSafe(daemon, { env: {} })).rejects.toThrow(/gs-daily-habit-tracker-app/);
  });

  it('only asks the daemon about platform-managed containers', async () => {
    const daemon = fakeDaemon([]);
    await assertSandboxSafe(daemon, { env: {} });
    expect(daemon.listContainers).toHaveBeenCalledWith({
      all: true,
      filters: { label: ['gs.managed=true'] },
    });
  });

  it('ignores containers belonging to this sandbox', async () => {
    const daemon = fakeDaemon([
      { Id: 'c'.repeat(64), Names: ['/gs-test-thing'], Labels: { 'gs.managed': 'true', [SANDBOX_LABEL]: 'sbx-1' } },
    ]);
    await expect(assertSandboxSafe(daemon, { sandboxId: 'sbx-1', env: {} })).resolves.toBeUndefined();
  });

  it('still refuses a foreign container even when one of ours is present', async () => {
    const daemon = fakeDaemon([
      { Id: 'c'.repeat(64), Labels: { 'gs.managed': 'true', [SANDBOX_LABEL]: 'sbx-1' } },
      { Id: 'd'.repeat(64), Names: ['/guildpay-api'], Labels: { 'gs.managed': 'true' } },
    ]);
    await expect(assertSandboxSafe(daemon, { sandboxId: 'sbx-1', env: {} })).rejects.toBeInstanceOf(SandboxRefused);
  });

  it('can be overridden only by an explicit, deliberate acknowledgement', async () => {
    // Documented for completeness. Setting this on a host with customer
    // workloads is a data-loss event; it exists for a human who has personally
    // confirmed the daemon is disposable.
    const daemon = fakeDaemon([{ Id: 'e'.repeat(64), Labels: { 'gs.managed': 'true' } }]);
    await expect(
      assertSandboxSafe(daemon, { env: { [ACK_SHARED_DAEMON_ENV]: '1' } }),
    ).resolves.toBeUndefined();
  });
});

describe('withSandbox', () => {
  it('refuses before opening a socket when Docker tests are not enabled', async () => {
    const saved = process.env[ALLOW_ENV];
    delete process.env[ALLOW_ENV];
    try {
      await expect(withSandbox(async () => 'never')).rejects.toThrow(new RegExp(ALLOW_ENV));
    } finally {
      if (saved !== undefined) process.env[ALLOW_ENV] = saved;
    }
  });
});

describeDocker('describeDocker', () => {
  it('only runs when real-daemon tests are explicitly enabled', () => {
    expect(dockerTestsEnabled()).toBe(true);
  });
});
