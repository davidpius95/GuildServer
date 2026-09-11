/**
 * The log drain manager against a fake Docker daemon: which containers it
 * follows, what it ships from them, and how it lets go. No real containers
 * are touched.
 */
import { PassThrough } from 'stream';
import { LogDrainManager, type DockerLike, type DrainSpec } from '../../src/services/log-drain/manager';

const NOW = Date.UTC(2026, 8, 11, 5, 0, 0);
const APP_LABEL = 'gs.app.id';
const SERVICE_LABEL = 'gs.service.id';

// The fake demuxer reads a 1-byte stream tag (1 = stdout, 2 = stderr) instead
// of Docker's 8-byte frame header; the manager only relies on the modem.
const frame = (stream: 1 | 2, text: string) => Buffer.concat([Buffer.from([stream]), Buffer.from(text)]);

function fakeDocker() {
  const running: Array<{ Id: string; Names: string[]; Labels: Record<string, string> }> = [];
  const streams = new Map<string, PassThrough[]>();
  const logCalls: Array<{ id: string; options: any }> = [];
  const tty = new Set<string>();
  let listError: Error | null = null;

  const docker: DockerLike = {
    listContainers: jest.fn(async (options: any) => {
      if (listError) throw listError;
      const [filter] = options.filters.label as string[];
      const [key, value] = filter.split('=');
      return running.filter((c) => c.Labels[key] === value || c.Labels.__ignoreFilter === 'yes');
    }),
    getContainer: jest.fn((id: string) => ({
      inspect: async () => ({ Name: `/${id}-name`, Config: { Tty: tty.has(id) } }),
      logs: async (options: any) => {
        logCalls.push({ id, options });
        const stream = new PassThrough();
        streams.set(id, [...(streams.get(id) ?? []), stream]);
        return stream;
      },
    })),
    modem: {
      demuxStream: (stream, stdout, stderr) => {
        stream.on('data', (chunk: Buffer) => (chunk[0] === 2 ? stderr : stdout).write(chunk.subarray(1)));
      },
    },
  };

  return {
    docker,
    logCalls,
    add: (id: string, labels: Record<string, string>) => running.push({ Id: id, Names: [`/${id}`], Labels: labels }),
    remove: (id: string) => running.splice(running.findIndex((c) => c.Id === id), 1),
    latestStream: (id: string) => streams.get(id)!.slice(-1)[0],
    setTty: (id: string) => tty.add(id),
    failListing: (error: Error | null) => {
      listError = error;
    },
  };
}

const spec = (over: Partial<DrainSpec> = {}): DrainSpec => ({
  id: 'drain-1',
  organizationId: 'org-1',
  resourceType: 'application',
  resourceId: 'app-1',
  resourceName: 'shop',
  target: { url: 'https://logs.example.com/ingest', headers: {}, format: 'json' },
  ...over,
});

function setup(specs: DrainSpec[], extra: { maxFollowers?: number } = {}) {
  const fake = fakeDocker();
  const fetch = jest.fn().mockResolvedValue({ status: 200 });
  let current = specs;
  const saveReport = jest.fn().mockResolvedValue(undefined);
  const manager = new LogDrainManager({
    docker: fake.docker,
    loadDrains: async () => current,
    saveReport,
    shipperDeps: { fetch: fetch as any, env: {} as NodeJS.ProcessEnv, resolve: async () => [{ address: '93.184.216.34' }], now: () => NOW },
    flushIntervalMs: 0,
    reportIntervalMs: 0,
    now: () => NOW,
    ...extra,
  });
  const shipped = () => fetch.mock.calls.flatMap(([, init]) => JSON.parse(init.body));
  return { fake, fetch, manager, saveReport, shipped, setSpecs: (next: DrainSpec[]) => (current = next) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => jest.clearAllMocks());

it('follows running containers of the drained resource from now, and ships their lines with context', async () => {
  const { fake, manager, shipped } = setup([spec()]);
  fake.add('c1aaaaaaaaaaaaaaaaaa', { [APP_LABEL]: 'app-1' });
  await manager.reconcile();

  expect(fake.docker.listContainers).toHaveBeenCalledWith({ filters: { label: [`${APP_LABEL}=app-1`], status: ['running'] } });
  expect(fake.logCalls).toEqual([
    { id: 'c1aaaaaaaaaaaaaaaaaa', options: { follow: true, stdout: true, stderr: true, timestamps: true, since: Math.floor(NOW / 1000) } },
  ]);

  const stream = fake.latestStream('c1aaaaaaaaaaaaaaaaaa');
  stream.write(frame(1, '2026-09-11T05:00:00.123456789Z listening on :3000\n'));
  stream.write(frame(2, '2026-09-11T05:00:01Z boom\n'));
  await settle();
  await manager.flush();

  expect(shipped()).toEqual([
    {
      timestamp: '2026-09-11T05:00:00.123456789Z',
      message: 'listening on :3000',
      stream: 'stdout',
      resource: { type: 'application', id: 'app-1', name: 'shop' },
      container: { id: 'c1aaaaaaaaaa', name: 'c1aaaaaaaaaaaaaaaaaa-name' },
      source: 'guildserver',
    },
    expect.objectContaining({ message: 'boom', stream: 'stderr' }),
  ]);
  await manager.stop();
});

it('uses the stack label for Compose services', async () => {
  const { fake, manager } = setup([spec({ resourceType: 'service', resourceId: 'svc-1' })]);
  fake.add('s1', { [SERVICE_LABEL]: 'svc-1' });
  await manager.reconcile();
  expect(fake.docker.listContainers).toHaveBeenCalledWith({ filters: { label: [`${SERVICE_LABEL}=svc-1`], status: ['running'] } });
  expect(manager.followerCount).toBe(1);
  await manager.stop();
});

it('never follows a container whose own label names a different resource', async () => {
  const { fake, manager } = setup([spec()]);
  fake.add('intruder', { [APP_LABEL]: 'someone-else', __ignoreFilter: 'yes' });
  await manager.reconcile();
  expect(fake.logCalls).toHaveLength(0);
  expect(manager.followerCount).toBe(0);
  await manager.stop();
});

it('lets go of containers that are gone, and of drains that are removed, shipping what was buffered', async () => {
  const { fake, manager, fetch, shipped, setSpecs } = setup([spec(), spec({ id: 'drain-2', resourceId: 'app-2' })]);
  fake.add('c1', { [APP_LABEL]: 'app-1' });
  fake.add('c2', { [APP_LABEL]: 'app-2' });
  await manager.reconcile();
  expect(manager.followerCount).toBe(2);

  const first = fake.latestStream('c1');
  fake.remove('c1');
  await manager.reconcile();
  expect(first.destroyed).toBe(true);
  expect(manager.followerCount).toBe(1);

  const second = fake.latestStream('c2');
  second.write(frame(1, 'last words\n'));
  await settle();
  setSpecs([]);
  await manager.reconcile();
  expect(second.destroyed).toBe(true);
  expect(manager.followerCount).toBe(0);
  expect(fetch).toHaveBeenCalled();
  expect(shipped().map((r: any) => r.message)).toContain('last words');
});

it('resumes from the last second it saw when a follower ends', async () => {
  const { fake, manager } = setup([spec()]);
  fake.add('c1', { [APP_LABEL]: 'app-1' });
  await manager.reconcile();
  const stream = fake.latestStream('c1');
  stream.write(frame(1, '2026-09-11T04:59:30.500Z before restart\n'));
  await settle();
  stream.end();
  await settle();
  expect(manager.followerCount).toBe(0);

  await manager.reconcile();
  expect(fake.logCalls).toHaveLength(2);
  expect(fake.logCalls[1].options.since).toBe(Math.floor(Date.UTC(2026, 8, 11, 4, 59, 30) / 1000));
  await manager.stop();
});

it('reads TTY containers without demultiplexing', async () => {
  const { fake, manager, shipped } = setup([spec()]);
  fake.add('tty1', { [APP_LABEL]: 'app-1' });
  fake.setTty('tty1');
  await manager.reconcile();
  fake.latestStream('tty1').write(Buffer.from('plain output\n'));
  await settle();
  await manager.flush();
  expect(shipped()).toEqual([expect.objectContaining({ message: 'plain output', stream: 'stdout' })]);
  await manager.stop();
});

it('respects the follower limit', async () => {
  const { fake, manager } = setup([spec()], { maxFollowers: 1 });
  fake.add('c1', { [APP_LABEL]: 'app-1' });
  fake.add('c2', { [APP_LABEL]: 'app-1' });
  await manager.reconcile();
  expect(fake.logCalls).toHaveLength(1);
  await manager.stop();
});

it('keeps existing followers through a Docker error', async () => {
  const { fake, manager } = setup([spec()]);
  fake.add('c1', { [APP_LABEL]: 'app-1' });
  await manager.reconcile();
  const stream = fake.latestStream('c1');

  fake.failListing(new Error('connect ENOENT /var/run/docker.sock'));
  await manager.reconcile();
  expect(stream.destroyed).toBe(false);
  expect(manager.followerCount).toBe(1);
  fake.failListing(null);
  await manager.stop();
});

it('sends later lines to a changed endpoint', async () => {
  const { fake, manager, fetch, setSpecs } = setup([spec()]);
  fake.add('c1', { [APP_LABEL]: 'app-1' });
  await manager.reconcile();

  setSpecs([spec({ target: { url: 'https://new-logs.example.com/ingest', headers: {}, format: 'json' } })]);
  await manager.reconcile();
  fake.latestStream('c1').write(frame(1, 'after the change\n'));
  await settle();
  await manager.flush();

  const urls = fetch.mock.calls.map(([url]) => url);
  expect(urls[urls.length - 1]).toBe('https://new-logs.example.com/ingest');
  await manager.stop();
});

it('saves delivery counts for the drain', async () => {
  const { fake, manager, saveReport } = setup([spec()]);
  fake.add('c1', { [APP_LABEL]: 'app-1' });
  await manager.reconcile();
  fake.latestStream('c1').write(frame(1, 'one\ntwo\n'));
  await settle();
  await manager.flush();
  await manager.stop();
  const total = saveReport.mock.calls.filter(([id]) => id === 'drain-1').reduce((n, [, report]) => n + report.sent, 0);
  expect(total).toBe(2);
});
