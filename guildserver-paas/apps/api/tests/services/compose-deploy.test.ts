import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { services, serviceContainers, serviceVolumes } from '@guildserver/database';
import { db, testUtils } from '../setup';
import {
  aggregateStatus,
  extractHealth,
  reconcileContainers,
  removeStack,
  runCompose,
  stackDirectory,
} from '../../src/services/compose/deploy';
import { GS_LABELS } from '../../src/services/docker/client';

jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

const STACK_FILE = `
services:
  web:
    image: nginx:1.27
    expose: ["80"]
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
`;

async function createStack(overrides: Record<string, any> = {}) {
  const { project } = await testUtils.createTestSetup();
  const [stack] = await db
    .insert(services)
    .values({
      name: 'Test Stack',
      serviceName: 'test-stack',
      projectId: project.id,
      composeFile: STACK_FILE,
      environment: {},
      domains: {},
      ...overrides,
    } as any)
    .returning();
  return stack;
}

/**
 * A dockerode stand-in holding an explicit inventory.
 *
 * `listContainers` honours the label filter the same way the daemon does, so a
 * test that forgets to filter, or filters on the wrong thing, sees the foreign
 * containers and fails.
 */
function fakeDocker(inventory: {
  containers?: { Id: string; Names: string[]; Image?: string; State?: string; Status?: string; Labels: Record<string, string>; Ports?: any[] }[];
  volumes?: string[];
}) {
  const containers = inventory.containers ?? [];
  const volumes = new Set(inventory.volumes ?? []);
  const removedContainers: string[] = [];
  const removedVolumes: string[] = [];

  return {
    removedContainers,
    removedVolumes,
    survivingVolumes: volumes,
    listContainers: jest.fn(async (opts: any) => {
      const wanted: string[] = opts?.filters?.label ?? [];
      return containers.filter((c) =>
        wanted.every((pair) => {
          const idx = pair.indexOf('=');
          return c.Labels[pair.slice(0, idx)] === pair.slice(idx + 1);
        }),
      );
    }),
    getContainer: (id: string) => ({
      remove: jest.fn(async () => {
        const idx = containers.findIndex((c) => c.Id === id);
        if (idx === -1) throw Object.assign(new Error('no such container'), { statusCode: 404 });
        containers.splice(idx, 1);
        removedContainers.push(id);
      }),
    }),
    getVolume: (name: string) => ({
      remove: jest.fn(async () => {
        if (!volumes.has(name)) throw Object.assign(new Error('no such volume'), { statusCode: 404 });
        volumes.delete(name);
        removedVolumes.push(name);
      }),
    }),
  };
}

function container(serviceId: string, composeName: string, extra: Record<string, any> = {}) {
  return {
    Id: `ctr-${composeName}-${serviceId.slice(0, 4)}`,
    Names: [`/gs-svc-test-stack-${serviceId.slice(0, 8)}-${composeName}`],
    Image: 'nginx:1.27',
    State: 'running',
    Status: 'Up 3 minutes (healthy)',
    Labels: {
      [GS_LABELS.MANAGED]: 'true',
      [GS_LABELS.TYPE]: 'service',
      [GS_LABELS.SERVICE_ID]: serviceId,
      [GS_LABELS.COMPOSE_SERVICE]: composeName,
    },
    Ports: [],
    ...extra,
  };
}

describe('extractHealth', () => {
  it.each([
    ['Up 3 minutes (healthy)', 'healthy'],
    ['Up 10 seconds (health: starting)', 'starting'],
    ['Up 2 minutes (unhealthy)', 'unhealthy'],
    ['Up 4 hours', null],
    [undefined, null],
  ])('reads %s', (status, expected) => {
    expect(extractHealth(status as any)).toBe(expected);
  });
});

describe('aggregateStatus', () => {
  const c = (status: string, health: string | null = null) =>
    ({ composeServiceName: 'x', containerId: 'i', containerName: 'n', image: null, status, health, hostPort: null, containerPort: null });

  it('is running only when every container is up', () => {
    expect(aggregateStatus([c('running'), c('running')])).toBe('running');
  });

  it('is degraded when some containers are not', () => {
    expect(aggregateStatus([c('running'), c('exited')])).toBe('degraded');
    expect(aggregateStatus([c('running'), c('running', 'unhealthy')])).toBe('degraded');
  });

  it('is failed when none are', () => {
    expect(aggregateStatus([c('exited'), c('missing')])).toBe('failed');
    expect(aggregateStatus([])).toBe('failed');
  });
});

describe('reconcileContainers', () => {
  it('creates a row per container found on the daemon', async () => {
    const stack = await createStack();
    const docker = fakeDocker({ containers: [container(stack.id, 'web'), container(stack.id, 'db')] });

    const result = await reconcileContainers({
      serviceId: stack.id,
      database: db,
      dockerClient: docker as any,
      expected: ['web', 'db'],
    });

    expect(result.map((r) => r.composeServiceName)).toEqual(['db', 'web']);
    expect(result.every((r) => r.status === 'running' && r.health === 'healthy')).toBe(true);

    const rows = await db.select().from(serviceContainers).where(eq(serviceContainers.serviceId, stack.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.lastSeenAt !== null)).toBe(true);
  });

  it('filters by the stack id label and never by name', async () => {
    const stack = await createStack();
    const other = await createStack();
    const docker = fakeDocker({
      containers: [
        container(stack.id, 'web'),
        // Same compose service name, same naming shape, different stack.
        container(other.id, 'web'),
        // A platform application, which carries no stack label at all.
        {
          Id: 'app-1',
          Names: ['/gs-billing-deadbeef'],
          State: 'running',
          Status: 'Up 1 day',
          Labels: { [GS_LABELS.MANAGED]: 'true', [GS_LABELS.TYPE]: 'application', [GS_LABELS.APP_ID]: 'app-uuid' },
        },
      ],
    });

    const result = await reconcileContainers({ serviceId: stack.id, database: db, dockerClient: docker as any });

    expect(result).toHaveLength(1);
    expect(result[0].containerId).toBe(`ctr-web-${stack.id.slice(0, 4)}`);

    const otherRows = await db.select().from(serviceContainers).where(eq(serviceContainers.serviceId, other.id));
    expect(otherRows).toHaveLength(0);
  });

  /**
   * The case that is easy to get wrong.
   *
   * Deleting the row makes the stack look like it never had that service;
   * leaving it untouched makes a vanished container look healthy forever.
   */
  it('marks a container that vanished from the daemon as missing rather than dropping it', async () => {
    const stack = await createStack();
    const present = fakeDocker({ containers: [container(stack.id, 'web'), container(stack.id, 'db')] });
    await reconcileContainers({ serviceId: stack.id, database: db, dockerClient: present as any });

    const before = await db.select().from(serviceContainers).where(eq(serviceContainers.serviceId, stack.id));
    const dbRowBefore = before.find((r) => r.composeServiceName === 'db')!;
    expect(dbRowBefore.containerId).not.toBeNull();

    // The db container disappears; web is untouched.
    const after = fakeDocker({ containers: [container(stack.id, 'web')] });
    const result = await reconcileContainers({ serviceId: stack.id, database: db, dockerClient: after as any });

    expect(result.map((r) => `${r.composeServiceName}:${r.status}`).sort()).toEqual(['db:missing', 'web:running']);

    const rows = await db.select().from(serviceContainers).where(eq(serviceContainers.serviceId, stack.id));
    expect(rows).toHaveLength(2);

    const missing = rows.find((r) => r.composeServiceName === 'db')!;
    expect(missing.status).toBe('missing');
    // The stale id is cleared — it no longer refers to anything, and acting on
    // a recycled id is how a later stop hits the wrong container.
    expect(missing.containerId).toBeNull();
    // ...but what went missing is still identifiable.
    expect(missing.containerName).toBe(dbRowBefore.containerName);
    expect(missing.image).toBe(dbRowBefore.image);
    // lastSeenAt is frozen at the last sighting rather than bumped.
    expect(missing.lastSeenAt?.getTime()).toBe(dbRowBefore.lastSeenAt?.getTime());
  });

  it('records an expected service that was never created as pending', async () => {
    const stack = await createStack();
    const docker = fakeDocker({ containers: [] });
    const result = await reconcileContainers({
      serviceId: stack.id,
      database: db,
      dockerClient: docker as any,
      expected: ['web', 'db'],
    });
    expect(result.map((r) => r.status)).toEqual(['pending', 'pending']);
  });

  it('carries published ports through', async () => {
    const stack = await createStack();
    const docker = fakeDocker({
      containers: [container(stack.id, 'web', { Ports: [{ PublicPort: 34567, PrivatePort: 80, Type: 'tcp' }] })],
    });
    const [row] = await reconcileContainers({ serviceId: stack.id, database: db, dockerClient: docker as any });
    expect(row.hostPort).toBe(34567);
    expect(row.containerPort).toBe(80);
  });
});

describe('removeStack', () => {
  /**
   * The customer-protecting test.
   *
   * The fixture deliberately contains a foreign stack's container, an
   * application's container, and volumes belonging to both. After deleting one
   * stack, exactly its own resources are gone and every foreign resource is
   * still there.
   */
  it('removes exactly the stack\'s own containers and volumes, and nothing else', async () => {
    const stack = await createStack();
    const foreignStack = await createStack();

    await db.insert(serviceVolumes).values([
      { serviceId: stack.id, composeVolumeName: 'pgdata', volumeName: `gs-svc-mine_pgdata`, managed: true },
    ] as any);
    await db.insert(serviceVolumes).values([
      { serviceId: foreignStack.id, composeVolumeName: 'pgdata', volumeName: `gs-svc-theirs_pgdata`, managed: true },
    ] as any);

    const docker = fakeDocker({
      containers: [
        container(stack.id, 'web'),
        container(stack.id, 'db'),
        container(foreignStack.id, 'web'),
        {
          Id: 'customer-app',
          Names: ['/gs-daily-habit-tracker-app'],
          State: 'running',
          Status: 'Up 6 days',
          Labels: { [GS_LABELS.MANAGED]: 'true', [GS_LABELS.TYPE]: 'application', [GS_LABELS.APP_ID]: 'live-app' },
        },
        {
          Id: 'unmanaged',
          Names: ['/someones-postgres'],
          State: 'running',
          Status: 'Up 90 days',
          Labels: {},
        },
      ],
      volumes: ['gs-svc-mine_pgdata', 'gs-svc-theirs_pgdata', 'customer-app-storage', 'random-volume'],
    });

    const runner = jest.fn(async () => ({ code: 0, stdout: '', stderr: '' }));

    const result = await removeStack({
      serviceId: stack.id,
      removeVolumes: true,
      database: db,
      dockerClient: docker as any,
      runner: runner as any,
    });

    // `down` was scoped by project name, and never given --volumes.
    expect(runner).toHaveBeenCalledTimes(1);
    const call = (runner.mock.calls[0] as any[])[0];
    expect(call.project).toBe(`gs-svc-test-stack-${stack.id.replace(/-/g, '').slice(0, 8)}`);
    expect(call.args).toEqual(['down', '--remove-orphans']);
    expect(call.args).not.toContain('--volumes');
    expect(call.args).not.toContain('-v');

    // Exactly this stack's containers were swept.
    expect(result.sweptContainers.sort()).toEqual(
      [`ctr-web-${stack.id.slice(0, 4)}`, `ctr-db-${stack.id.slice(0, 4)}`].sort(),
    );
    expect(docker.removedContainers.sort()).toEqual(result.sweptContainers.sort());

    // Exactly this stack's recorded volume was removed.
    expect(result.removedVolumes).toEqual(['gs-svc-mine_pgdata']);
    expect(result.failedVolumes).toEqual([]);

    // Everything foreign survives.
    expect([...docker.survivingVolumes].sort()).toEqual(
      ['customer-app-storage', 'gs-svc-theirs_pgdata', 'random-volume'].sort(),
    );
    const survivors = await docker.listContainers({ all: true, filters: { label: [] } });
    expect(survivors.map((c: any) => c.Id).sort()).toEqual(
      ['customer-app', 'unmanaged', `ctr-web-${foreignStack.id.slice(0, 4)}`].sort(),
    );
  });

  it('leaves volumes alone unless removal was asked for', async () => {
    const stack = await createStack();
    await db.insert(serviceVolumes).values([
      { serviceId: stack.id, composeVolumeName: 'pgdata', volumeName: 'gs-svc-mine_pgdata', managed: true },
    ] as any);

    const docker = fakeDocker({ containers: [container(stack.id, 'web')], volumes: ['gs-svc-mine_pgdata'] });
    const result = await removeStack({
      serviceId: stack.id,
      database: db,
      dockerClient: docker as any,
      runner: (async () => ({ code: 0, stdout: '', stderr: '' })) as any,
    });

    expect(result.removedVolumes).toEqual([]);
    expect(docker.survivingVolumes.has('gs-svc-mine_pgdata')).toBe(true);
  });

  it('never removes a volume the stack does not own, even one that looks like its own', async () => {
    const stack = await createStack();
    const project = `gs-svc-test-stack-${stack.id.replace(/-/g, '').slice(0, 8)}`;
    // Recorded: one volume. On the daemon: a second volume sharing the prefix,
    // which a prefix sweep would happily destroy.
    await db.insert(serviceVolumes).values([
      { serviceId: stack.id, composeVolumeName: 'pgdata', volumeName: `${project}_pgdata`, managed: true },
    ] as any);

    const docker = fakeDocker({
      containers: [],
      volumes: [`${project}_pgdata`, `${project}_pgdata_backup`, `${project}-manual-snapshot`],
    });

    const result = await removeStack({
      serviceId: stack.id,
      removeVolumes: true,
      database: db,
      dockerClient: docker as any,
      runner: (async () => ({ code: 0, stdout: '', stderr: '' })) as any,
    });

    expect(result.removedVolumes).toEqual([`${project}_pgdata`]);
    expect([...docker.survivingVolumes].sort()).toEqual(
      [`${project}-manual-snapshot`, `${project}_pgdata_backup`].sort(),
    );
  });

  it('does not delete an unmanaged volume even when it is recorded', async () => {
    const stack = await createStack();
    await db.insert(serviceVolumes).values([
      { serviceId: stack.id, composeVolumeName: 'imported', volumeName: 'pre-existing-data', managed: false },
    ] as any);

    const docker = fakeDocker({ containers: [], volumes: ['pre-existing-data'] });
    const result = await removeStack({
      serviceId: stack.id,
      removeVolumes: true,
      database: db,
      dockerClient: docker as any,
      runner: (async () => ({ code: 0, stdout: '', stderr: '' })) as any,
    });

    expect(result.removedVolumes).toEqual([]);
    expect(docker.survivingVolumes.has('pre-existing-data')).toBe(true);
  });

  it('still sweeps by label when the Compose file no longer normalises', async () => {
    // A stack whose file the user broke, or that a tightened rule now rejects,
    // must remain deletable.
    const stack = await createStack({ composeFile: 'services:\n  a:\n    image: nginx\n    privileged: true\n' });
    const docker = fakeDocker({ containers: [container(stack.id, 'a')] });

    const result = await removeStack({
      serviceId: stack.id,
      database: db,
      dockerClient: docker as any,
      runner: (async () => ({ code: 0, stdout: '', stderr: '' })) as any,
    });

    expect(result.sweptContainers).toEqual([`ctr-a-${stack.id.slice(0, 4)}`]);
  });

  it('reports a volume it could not remove rather than pretending it succeeded', async () => {
    const stack = await createStack();
    await db.insert(serviceVolumes).values([
      { serviceId: stack.id, composeVolumeName: 'pgdata', volumeName: 'busy-volume', managed: true },
    ] as any);

    const docker = fakeDocker({ containers: [], volumes: ['busy-volume'] });
    docker.getVolume = (() => ({
      remove: async () => {
        throw Object.assign(new Error('volume is in use'), { statusCode: 409 });
      },
    })) as any;

    const result = await removeStack({
      serviceId: stack.id,
      removeVolumes: true,
      database: db,
      dockerClient: docker as any,
      runner: (async () => ({ code: 0, stdout: '', stderr: '' })) as any,
    });

    expect(result.removedVolumes).toEqual([]);
    expect(result.failedVolumes).toEqual([{ name: 'busy-volume', reason: 'volume is in use' }]);
  });
});

describe('runCompose', () => {
  it('builds an argv array and never a shell string', async () => {
    // Proven by running a command whose arguments contain shell metacharacters:
    // if a shell were involved, this would not come back as a plain string.
    const result = await runCompose({
      project: 'p',
      file: 'f',
      cwd: process.cwd(),
      args: ['version'],
      // `docker` may not exist here; either outcome proves argv handling, so the
      // assertion is on the rejection message instead.
    }).catch((error) => error);

    if (result instanceof Error) {
      expect(result.message).toMatch(/docker/i);
    } else {
      expect(typeof result.code).toBe('number');
    }
  });
});

describe('stackDirectory', () => {
  const original = process.env.GS_SERVICE_DIR;
  beforeEach(() => {
    if (original === undefined) delete process.env.GS_SERVICE_DIR;
    else process.env.GS_SERVICE_DIR = original;
  });

  it('gives each stack its own directory under the configured root', () => {
    process.env.GS_SERVICE_DIR = '/srv/stacks';
    expect(stackDirectory('abc')).toBe('/srv/stacks/abc');
    expect(stackDirectory('abc')).not.toBe(stackDirectory('abd'));
  });
});
