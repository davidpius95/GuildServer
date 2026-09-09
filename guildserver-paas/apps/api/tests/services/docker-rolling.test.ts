/**
 * Rolling deploy behaviour, against a fake dockerode.
 *
 * Nothing here touches a real Docker daemon — see tests/helpers/docker-sandbox.ts
 * for the (guarded, opt-in) tests that do.
 */

jest.mock('../../src/websocket/server', () => ({
  broadcastToUser: jest.fn(),
}));

jest.mock('../../src/services/docker/networks', () => ({
  ensureNetwork: jest.fn().mockResolvedValue(undefined),
}));

const mockCheckContainerHealth = jest.fn();
jest.mock('../../src/services/docker/health', () => ({
  checkContainerHealth: (...args: any[]) => mockCheckContainerHealth(...args),
  postDeployHealthCheck: jest.fn(),
}));

import { deployContainer, DeployOptions } from '../../src/services/docker/container';
import { CandidateFailedError, decidePromotionMode } from '../../src/services/docker/rolling';
import { buildTraefikLabels, traefikFingerprint } from '../../src/services/docker/primitives';

// --------------------------------------------------------------------------
// Fake dockerode
// --------------------------------------------------------------------------

type Event =
  | { type: 'create'; id: string; name: string; labels: Record<string, string>; hostPort: number }
  | { type: 'start'; id: string }
  | { type: 'stop'; id: string; t: number }
  | { type: 'remove'; id: string };

/**
 * Docker's log endpoint returns a multiplexed stream: each line is prefixed
 * with an 8-byte header (stream type, 3 padding bytes, big-endian length).
 * The fake reproduces that framing so `parseDockerLogs` is exercised for real
 * rather than being handed a convenient plain string.
 */
function frameDockerLogs(lines: string[]): Buffer {
  return Buffer.concat(
    lines.map((line) => {
      const payload = Buffer.from(`${line}\n`, 'utf8');
      const header = Buffer.alloc(8);
      header.writeUInt8(1, 0); // stdout
      header.writeUInt32BE(payload.length, 4);
      return Buffer.concat([header, payload]);
    }),
  );
}

interface FakeContainerState {
  Id: string;
  Names: string[];
  Labels: Record<string, string>;
  State: string;
  Ports: Array<{ PublicPort?: number; PrivatePort: number }>;
  logLines: string[];
  removed: boolean;
}

function makeFakeDocker(options?: { existing?: FakeContainerState[]; failStart?: boolean }) {
  const events: Event[] = [];
  const store = new Map<string, FakeContainerState>();
  let seq = 0;

  for (const c of options?.existing || []) store.set(c.Id, c);

  const handle = (id: string) => {
    const self = {
      id,
      async start() {
        const s = store.get(id)!;
        if (options?.failStart) {
          s.State = 'exited';
          throw new Error('boom: failed to start');
        }
        s.State = 'running';
        events.push({ type: 'start', id });
      },
      async inspect() {
        const s = store.get(id)!;
        return {
          Id: id,
          Name: s.Names[0],
          RestartCount: 0,
          State: { Running: s.State === 'running', Status: s.State, ExitCode: s.State === 'running' ? 0 : 1 },
          NetworkSettings: { Networks: { guildserver: { IPAddress: '172.20.0.5' } }, Ports: {} },
          Config: { Labels: s.Labels },
        } as any;
      },
      async logs() {
        return frameDockerLogs(store.get(id)!.logLines);
      },
      async stop(opts?: { t?: number }) {
        const s = store.get(id);
        if (!s) throw Object.assign(new Error('no such container'), { statusCode: 404 });
        events.push({ type: 'stop', id, t: opts?.t ?? -1 });
        s.State = 'exited';
      },
      async remove() {
        events.push({ type: 'remove', id });
        const s = store.get(id);
        if (s) s.removed = true;
        store.delete(id);
      },
    };
    return self as any;
  };

  const docker = {
    async listContainers(opts?: { all?: boolean; filters?: { label?: string[]; status?: string[] } }) {
      const labelFilters = opts?.filters?.label || [];
      return [...store.values()].filter((c) => {
        if (!opts?.all && c.State !== 'running') return false;
        if (opts?.filters?.status && !opts.filters.status.includes(c.State)) return false;
        return labelFilters.every((f) => {
          const idx = f.indexOf('=');
          const [k, v] = idx === -1 ? [f, undefined] : [f.slice(0, idx), f.slice(idx + 1)];
          return v === undefined ? k in c.Labels : c.Labels[k] === v;
        });
      });
    },
    async createContainer(config: any) {
      const id = `container-${++seq}`;
      const hostPort = Number(Object.values(config.HostConfig.PortBindings)[0]?.[0]?.HostPort);
      store.set(id, {
        Id: id,
        Names: [`/${config.name}`],
        Labels: { ...config.Labels },
        State: 'created',
        Ports: [{ PublicPort: hostPort, PrivatePort: 3000 }],
        logLines: ['starting…', 'Error: DATABASE_URL is not set'],
        removed: false,
      });
      events.push({ type: 'create', id, name: config.name, labels: { ...config.Labels }, hostPort });
      return handle(id);
    },
    getContainer: (id: string) => handle(id),
    async createVolume() {
      return {};
    },
    modem: { demuxStream: jest.fn() },
  };

  return { docker: docker as any, events, store };
}

const APP_ID = 'app-1111';
const DOMAINS = ['app.example.com'];

function incumbent(labels: Record<string, string>, id = 'incumbent-1'): FakeContainerState {
  return {
    Id: id,
    Names: ['/gs-myapp-oldoldol'],
    Labels: { 'gs.managed': 'true', 'gs.app.id': APP_ID, 'gs.app.name': 'myapp', 'gs.type': 'application', ...labels },
    State: 'running',
    Ports: [{ PublicPort: 10001, PrivatePort: 3000 }],
    logLines: ['incumbent serving'],
    removed: false,
  };
}

function baseOpts(overrides: Partial<DeployOptions> = {}): DeployOptions {
  return {
    deploymentId: 'deploy-abcdef01',
    applicationId: APP_ID,
    appName: 'myapp',
    projectId: 'proj-1',
    userId: 'user-1',
    // A `gs-` prefixed image short-circuits the registry pull.
    dockerImage: 'gs-myapp',
    dockerTag: 'latest',
    environment: { PORT: '3000' },
    containerPort: 3000,
    sourceType: 'git',
    domains: DOMAINS,
    ...overrides,
  };
}

/** Traefik labels the current deploy would publish, for building a matching incumbent. */
const matchingTraefikLabels = buildTraefikLabels({
  appName: 'myapp',
  domains: DOMAINS,
  servicePort: 3000,
  env: {} as NodeJS.ProcessEnv,
}).labels;

const healthy = { healthy: true, message: 'Service is responding', protocol: 'http' as const };
const unhealthy = { healthy: false, message: 'Service unreachable after 120s.' };

describe('rolling deploy', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckContainerHealth.mockResolvedValue(healthy);
    // Zero out the Traefik convergence pause so tests don't sit in a sleep.
    process.env.GS_TRAEFIK_CONVERGE_MS = '0';
    delete process.env.GS_ZERO_DOWNTIME;
    delete process.env.CLOUDFLARE_TUNNEL;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  describe('happy path (overlap)', () => {
    it('creates the candidate without router labels, health-gates it, then retires the incumbent — in that order', async () => {
      const { docker, events } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });

      const result = await deployContainer(baseOpts(), docker);

      const creates = events.filter((e) => e.type === 'create') as Extract<Event, { type: 'create' }>[];
      expect(creates).toHaveLength(2);

      // 1. The candidate carries the app's gs.* labels and gs.role=candidate,
      //    and NOT a single traefik.* label — Traefik must not be able to send
      //    it production traffic while it is unproven.
      const candidate = creates[0];
      expect(candidate.name).toBe('gs-myapp-deploy-a-candidate');
      expect(candidate.labels['gs.app.id']).toBe(APP_ID);
      expect(candidate.labels['gs.role']).toBe('candidate');
      expect(Object.keys(candidate.labels).filter((k) => k.startsWith('traefik.'))).toEqual([]);

      // 2. The health gate ran against the candidate, not against anything else.
      expect(mockCheckContainerHealth).toHaveBeenCalledTimes(1);
      expect(mockCheckContainerHealth.mock.calls[0][0]).toMatchObject({
        containerId: candidate.id,
        hostPort: candidate.hostPort,
        expectedContainerPort: 3000,
      });

      // 3. Only then is a routed container created.
      const promoted = creates[1];
      expect(promoted.name).toBe('gs-myapp-deploy-a');
      expect(promoted.labels['traefik.enable']).toBe('true');
      expect(traefikFingerprint(promoted.labels)).toBe(traefikFingerprint(matchingTraefikLabels));

      // 4. And only after THAT is the incumbent stopped.
      const promotedCreateIdx = events.indexOf(promoted);
      const incumbentStopIdx = events.findIndex((e) => e.type === 'stop' && e.id === 'incumbent-1');
      expect(incumbentStopIdx).toBeGreaterThan(promotedCreateIdx);
      expect(events.some((e) => e.type === 'remove' && e.id === 'incumbent-1')).toBe(true);

      // The candidate has done its job and is cleaned up.
      expect(events.some((e) => e.type === 'remove' && e.id === candidate.id)).toBe(true);

      expect(result.strategy).toBe('rolling');
      expect(result.promotionMode).toBe('overlap');
      expect(result.previousContainerId).toBe('incumbent-1');
      expect(result.containerId).toBe(promoted.id);
    }, 30000);

    it('never stops the incumbent before the replacement exists', async () => {
      const { docker, events } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });
      await deployContainer(baseOpts(), docker);

      const firstIncumbentTouch = events.findIndex(
        (e) => (e.type === 'stop' || e.type === 'remove') && e.id === 'incumbent-1',
      );
      const firstCreate = events.findIndex((e) => e.type === 'create');
      expect(firstCreate).toBeLessThan(firstIncumbentTouch);
    }, 30000);

    it('honours stop_grace_period when retiring the incumbent', async () => {
      const { docker, events } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });

      await deployContainer(baseOpts({ applicationConfig: { stop_grace_period: 45 } }), docker);

      const stop = events.find((e) => e.type === 'stop' && e.id === 'incumbent-1') as any;
      expect(stop.t).toBe(45);
    }, 30000);

    it('defaults the grace period to the legacy 10s when the column is NULL', async () => {
      const { docker, events } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });

      await deployContainer(baseOpts({ applicationConfig: { stop_grace_period: null } }), docker);

      const stop = events.find((e) => e.type === 'stop' && e.id === 'incumbent-1') as any;
      expect(stop.t).toBe(10);
    }, 30000);

    it('cold-starts cleanly when nothing is running yet', async () => {
      const { docker, events } = makeFakeDocker();
      const result = await deployContainer(baseOpts(), docker);
      expect(result.promotionMode).toBe('cold');
      expect(result.previousContainerId).toBeNull();
      expect(events.filter((e) => e.type === 'create')).toHaveLength(2);
    }, 30000);
  });

  describe('failure path — the behaviour that turns an outage into a no-op', () => {
    it('destroys the candidate, leaves the incumbent serving, and reports the candidate logs', async () => {
      mockCheckContainerHealth.mockResolvedValue(unhealthy);
      const { docker, events, store } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });

      const error = await deployContainer(baseOpts(), docker).catch((e) => e);

      expect(error).toBeInstanceOf(CandidateFailedError);
      expect(error.incumbentPreserved).toBe(true);
      // The candidate's own logs explain WHY the new version was rejected.
      expect(error.candidateLogs).toContain('Error: DATABASE_URL is not set');
      expect(error.message).toContain('Error: DATABASE_URL is not set');
      expect(error.message).toContain('still serving');

      const creates = events.filter((e) => e.type === 'create') as Extract<Event, { type: 'create' }>[];
      // Exactly one container was ever created: the candidate. No promotion happened.
      expect(creates).toHaveLength(1);
      expect(events.some((e) => e.type === 'remove' && e.id === creates[0].id)).toBe(true);

      // THE assertion: the incumbent was never touched.
      expect(events.filter((e) => e.id === 'incumbent-1')).toEqual([]);
      expect(store.get('incumbent-1')!.State).toBe('running');
      expect(store.get('incumbent-1')!.removed).toBe(false);
    }, 30000);

    it('reports that nothing was preserved when there was no incumbent to preserve', async () => {
      mockCheckContainerHealth.mockResolvedValue(unhealthy);
      const { docker } = makeFakeDocker();

      const error = await deployContainer(baseOpts(), docker).catch((e) => e);
      expect(error).toBeInstanceOf(CandidateFailedError);
      expect(error.incumbentPreserved).toBe(false);
    }, 30000);

    it('treats a thrown health check the same as an unhealthy one', async () => {
      mockCheckContainerHealth.mockRejectedValue(new Error('docker socket hung up'));
      const { docker, events, store } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });

      const error = await deployContainer(baseOpts(), docker).catch((e) => e);
      expect(error).toBeInstanceOf(CandidateFailedError);
      expect(events.filter((e) => e.id === 'incumbent-1')).toEqual([]);
      expect(store.get('incumbent-1')!.State).toBe('running');
    }, 30000);
  });

  describe('serial promotion when the Traefik labels diverge', () => {
    it('retires the incumbent BEFORE promoting, because overlapping conflicting routers takes the app down', async () => {
      // Incumbent was deployed against a different domain, so its router rule
      // differs. Two containers publishing the same router name with different
      // rules makes Traefik discard the router entirely.
      const stale = buildTraefikLabels({
        appName: 'myapp',
        domains: ['old.example.com'],
        servicePort: 3000,
        env: {} as NodeJS.ProcessEnv,
      }).labels;
      const { docker, events } = makeFakeDocker({ existing: [incumbent(stale)] });

      const result = await deployContainer(baseOpts(), docker);
      expect(result.promotionMode).toBe('serial');

      const incumbentRemoveIdx = events.findIndex((e) => e.type === 'remove' && e.id === 'incumbent-1');
      const creates = events.filter((e) => e.type === 'create');
      const promotedCreateIdx = events.indexOf(creates[1]);

      expect(incumbentRemoveIdx).toBeGreaterThan(events.indexOf(creates[0])); // candidate first
      expect(incumbentRemoveIdx).toBeLessThan(promotedCreateIdx); // then retire, then promote
    }, 30000);
  });

  describe('decidePromotionMode', () => {
    const asInfo = (labels: Record<string, string>) => ({ Id: 'x', Labels: labels } as any);

    it('is cold with no running incumbent', () => {
      expect(decidePromotionMode(matchingTraefikLabels, []).mode).toBe('cold');
    });

    it('overlaps when the incumbent publishes an identical Traefik config', () => {
      expect(decidePromotionMode(matchingTraefikLabels, [asInfo(matchingTraefikLabels)]).mode).toBe('overlap');
    });

    it('ignores non-traefik label differences', () => {
      const withExtras = { ...matchingTraefikLabels, 'gs.deployment.id': 'something-else' };
      expect(decidePromotionMode(matchingTraefikLabels, [asInfo(withExtras)]).mode).toBe('overlap');
    });

    it('serialises when any running incumbent diverges', () => {
      const diverged = { ...matchingTraefikLabels, 'traefik.http.routers.myapp.rule': 'Host(`other`)' };
      expect(decidePromotionMode(matchingTraefikLabels, [asInfo(matchingTraefikLabels), asInfo(diverged)]).mode).toBe(
        'serial',
      );
    });

    it('overlaps for an app with no domain, since neither side has Traefik labels', () => {
      expect(decidePromotionMode({}, [asInfo({})]).mode).toBe('overlap');
    });
  });
});

describe('legacy recreate path', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckContainerHealth.mockResolvedValue(healthy);
    delete process.env.GS_ZERO_DOWNTIME;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('GS_ZERO_DOWNTIME=0 takes the legacy path: remove first, then create', async () => {
    process.env.GS_ZERO_DOWNTIME = '0';
    const { docker, events } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });

    const result = await deployContainer(baseOpts(), docker);

    expect(result.strategy).toBe('recreate');
    // Exactly one container created — no candidate.
    const creates = events.filter((e) => e.type === 'create');
    expect(creates).toHaveLength(1);
    expect(creates[0].name).toBe('gs-myapp-deploy-a');
    // And it was created only after the incumbent was destroyed. This is the
    // outage window the rolling path exists to remove.
    expect(events.findIndex((e) => e.type === 'remove' && e.id === 'incumbent-1')).toBeLessThan(
      events.indexOf(creates[0]),
    );
    // No health gate on this path — the queue runs its own check afterwards.
    expect(mockCheckContainerHealth).not.toHaveBeenCalled();
  }, 30000);

  it('keeps the routed labels identical to what the rolling path publishes', async () => {
    process.env.GS_ZERO_DOWNTIME = '0';
    const { docker, events } = makeFakeDocker();
    await deployContainer(baseOpts(), docker);

    const created = events.find((e) => e.type === 'create') as Extract<Event, { type: 'create' }>;
    expect(traefikFingerprint(created.labels)).toBe(traefikFingerprint(matchingTraefikLabels));
  }, 30000);

  it('an app with no domain defaults to recreate', async () => {
    const { docker, events } = makeFakeDocker({ existing: [incumbent({})] });
    const result = await deployContainer(baseOpts({ domains: undefined }), docker);
    expect(result.strategy).toBe('recreate');
    expect(events.filter((e) => e.type === 'create')).toHaveLength(1);
  }, 30000);

  it('preview containers keep the legacy path and its app-name scoping', async () => {
    const otherBranch = incumbent(matchingTraefikLabels, 'other-branch');
    otherBranch.Labels['gs.app.name'] = 'myapp-preview-other';
    const thisBranch = incumbent(matchingTraefikLabels, 'this-branch');
    thisBranch.Labels['gs.app.name'] = 'myapp-preview-feat';

    const { docker, events } = makeFakeDocker({ existing: [otherBranch, thisBranch] });

    const result = await deployContainer(baseOpts({ appName: 'myapp-preview-feat' }), docker);

    expect(result.strategy).toBe('recreate');
    // Only this branch's container was replaced; the sibling preview is untouched.
    expect(events.some((e) => e.type === 'remove' && e.id === 'this-branch')).toBe(true);
    expect(events.some((e) => e.id === 'other-branch')).toBe(false);
  }, 30000);

  it('an app with persistent storage stays on recreate unless the operator opts in', async () => {
    const { docker, events } = makeFakeDocker({ existing: [incumbent(matchingTraefikLabels)] });

    const result = await deployContainer(
      baseOpts({ persistentStoragePath: '/data', applicationConfig: { deployment_strategy: 'rolling' } }),
      docker,
    );

    // Two containers sharing one named volume can corrupt an embedded database,
    // so the safe reading wins by default.
    expect(result.strategy).toBe('recreate');
    expect(events.filter((e) => e.type === 'create')).toHaveLength(1);
  }, 30000);
});
