import { describe, it, expect } from '@jest/globals';
import { parseCompose, ComposeParseError, parseMemoryString } from '../../src/services/compose/parse';

/** Assert a parse fails and return the problem list, so tests read as one line. */
function problemsFor(raw: string): string[] {
  try {
    parseCompose(raw);
  } catch (error) {
    if (error instanceof ComposeParseError) return error.problems;
    throw error;
  }
  throw new Error('expected parseCompose to reject, but it accepted the file');
}

describe('parseCompose', () => {
  describe('valid stacks', () => {
    it('parses a realistic web + worker + db + queue stack', () => {
      const result = parseCompose(`
services:
  web:
    image: ghcr.io/acme/web:1.4.2
    expose: ["3000"]
    environment:
      NODE_ENV: production
      REDIS_URL: redis://queue:6379
    depends_on:
      db:
        condition: service_healthy
      queue:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 512m
          cpus: "0.5"
  worker:
    image: ghcr.io/acme/web:1.4.2
    command: ["node", "worker.js"]
    depends_on: [db, queue]
  db:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=hunter2
    volumes:
      - pgdata:/var/lib/postgresql/data
  queue:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
volumes:
  pgdata:
  redisdata:
`);

      expect(result.services.map((s) => s.name)).toEqual(['web', 'worker', 'db', 'queue']);
      expect(result.volumes.map((v) => v.name)).toEqual(['pgdata', 'redisdata']);

      const web = result.services.find((s) => s.name === 'web')!;
      expect(web.expose).toEqual([3000]);
      expect(web.dependsOn).toEqual(['db', 'queue']);
      expect(web.healthcheck).toEqual({
        test: ['CMD', 'curl', '-f', 'http://localhost:3000/health'],
        interval: '10s',
        retries: 5,
      });
      expect(web.resources).toEqual({ memoryBytes: 512 * 1024 * 1024, nanoCpus: 5e8 });

      // List-form environment is normalised to the same shape as map form.
      const db = result.services.find((s) => s.name === 'db')!;
      expect(db.environment).toEqual({ POSTGRES_PASSWORD: 'hunter2' });
      expect(db.volumes).toEqual([
        { kind: 'named', source: 'pgdata', target: '/var/lib/postgresql/data', readOnly: false, raw: 'pgdata:/var/lib/postgresql/data' },
      ]);
    });

    it('accepts both short and long port forms and records read-only mounts', () => {
      const result = parseCompose(`
services:
  app:
    image: nginx
    ports:
      - "8080:80"
      - "5353:53/udp"
      - target: 9000
        published: 9000
        protocol: tcp
    volumes:
      - assets:/srv/assets:ro
volumes:
  assets:
`);
      const app = result.services[0];
      expect(app.ports).toEqual([
        { target: 80, published: 8080, protocol: 'tcp', raw: '8080:80' },
        { target: 53, published: 5353, protocol: 'udp', raw: '5353:53/udp' },
        { target: 9000, published: 9000, protocol: 'tcp', raw: '9000:9000/tcp' },
      ]);
      expect(app.volumes[0].readOnly).toBe(true);
    });

    it('notes that `version:` is obsolete instead of failing on it', () => {
      const result = parseCompose(`
version: "3.8"
services:
  app:
    image: nginx
`);
      expect(result.notes.join(' ')).toContain('obsolete');
    });

    it('ignores `x-` extension fields at both levels', () => {
      const result = parseCompose(`
x-shared: &shared
  restart: always
services:
  app:
    image: nginx
    x-guildserver-note: hello
`);
      expect(result.services).toHaveLength(1);
    });
  });

  describe('malformed input', () => {
    it('reports the line number for invalid YAML', () => {
      expect(() => parseCompose('services:\n  app:\n   image: [unclosed\n')).toThrow(ComposeParseError);
      try {
        parseCompose('services:\n  app:\n   image: [unclosed\n');
      } catch (error: any) {
        expect(error.message).toMatch(/not valid YAML \(line \d+/);
      }
    });

    it('rejects an empty file', () => {
      expect(() => parseCompose('   ')).toThrow(/empty/i);
    });

    it('rejects a file with no services key', () => {
      expect(() => parseCompose('volumes:\n  data:\n')).toThrow(/no `services:` key/);
    });

    it('rejects a scalar document', () => {
      expect(() => parseCompose('just a string')).toThrow(/must be a YAML mapping/);
    });

    it('rejects a service that declares neither image nor build', () => {
      expect(problemsFor('services:\n  app:\n    restart: always\n')).toEqual([
        'services.app: needs either `image:` or `build:`',
      ]);
    });

    it('rejects depends_on pointing at a service that is not in the file', () => {
      expect(problemsFor('services:\n  app:\n    image: nginx\n    depends_on: [cache]\n')[0]).toContain(
        '"cache", which is not a service in this file',
      );
    });

    it('rejects a named mount with no top-level volume declaration', () => {
      expect(problemsFor('services:\n  app:\n    image: nginx\n    volumes:\n      - data:/data\n')[0]).toContain(
        'not declared under the top-level `volumes:` key',
      );
    });
  });

  describe('unsupported constructs are rejected loudly', () => {
    // The whole point of the parser: a key we do not honour must never be
    // silently dropped, because the resulting stack deploys green and is broken.
    it.each([
      ['network_mode', 'services:\n  app:\n    image: nginx\n    network_mode: host\n', /own isolated network/],
      ['privileged', 'services:\n  app:\n    image: nginx\n    privileged: true\n', /`privileged:` is not supported/],
      ['cap_add', 'services:\n  app:\n    image: nginx\n    cap_add: [SYS_ADMIN]\n', /`cap_add:` is not supported/],
      ['pid', 'services:\n  app:\n    image: nginx\n    pid: host\n', /`pid:` is not supported/],
      ['devices', 'services:\n  app:\n    image: nginx\n    devices: ["/dev/sda"]\n', /`devices:` is not supported/],
      ['container_name', 'services:\n  app:\n    image: nginx\n    container_name: mine\n', /managed by GuildServer/],
      ['profiles', 'services:\n  app:\n    image: nginx\n    profiles: [dev]\n', /every service in the file is deployed/],
      ['extends', 'services:\n  app:\n    image: nginx\n    extends: {file: a.yml, service: b}\n', /paste the extended service inline/],
      ['links', 'services:\n  app:\n    image: nginx\n    links: [db]\n', /legacy and not supported/],
      ['scale', 'services:\n  app:\n    image: nginx\n    scale: 3\n', /one container per service/],
      ['secrets (top level)', 'secrets:\n  a:\n    file: ./a\nservices:\n  app:\n    image: nginx\n', /top-level `secrets:`/],
      ['configs (top level)', 'configs:\n  a:\n    file: ./a\nservices:\n  app:\n    image: nginx\n', /top-level `configs:`/],
      ['include', 'include:\n  - other.yml\nservices:\n  app:\n    image: nginx\n', /`include:` is not supported/],
    ])('rejects %s', (_label, file, matcher) => {
      const problems = problemsFor(file);
      expect(problems.some((p) => matcher.test(p))).toBe(true);
    });

    it('rejects an unknown service key by name rather than ignoring it', () => {
      expect(problemsFor('services:\n  app:\n    image: nginx\n    nosuchkey: 1\n')).toEqual([
        'services.app: unknown key `nosuchkey:`',
      ]);
    });

    it('rejects an unknown top-level key by name', () => {
      expect(problemsFor('nonsense: 1\nservices:\n  app:\n    image: nginx\n')).toEqual([
        'unknown top-level key `nonsense:`',
      ]);
    });

    it('collects every problem in one pass rather than stopping at the first', () => {
      const problems = problemsFor(`
services:
  a:
    image: nginx
    privileged: true
    network_mode: host
  b:
    restart: always
`);
      expect(problems).toHaveLength(3);
    });

    it('rejects deploy.replicas > 1 but tolerates replicas: 1', () => {
      expect(problemsFor('services:\n  a:\n    image: nginx\n    deploy:\n      replicas: 3\n')[0]).toContain(
        'one container per service',
      );
      expect(() => parseCompose('services:\n  a:\n    image: nginx\n    deploy:\n      replicas: 1\n')).not.toThrow();
    });

    it('rejects env_file, which points at files the platform never sees', () => {
      expect(problemsFor('services:\n  a:\n    image: nginx\n    env_file: .env\n')[0]).toContain(
        "move those variables into the stack's environment",
      );
    });

    it('rejects a bare environment key that would silently inherit from the host shell', () => {
      const problems = problemsFor('services:\n  a:\n    image: nginx\n    environment:\n      - LEAKED\n');
      expect(problems[0]).toContain('LEAKED');
      expect(problems[0]).toContain('host shell');
    });
  });

  describe('host escape attempts', () => {
    it('refuses to mount the Docker socket, and says why', () => {
      const problems = problemsFor(`
services:
  agent:
    image: nginx
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`);
      expect(problems[0]).toContain('control of every container on this host');
    });

    it('refuses any absolute host bind mount', () => {
      expect(problemsFor('services:\n  a:\n    image: nginx\n    volumes:\n      - /etc/passwd:/etc/passwd:ro\n')[0]).toContain(
        'host filesystem is shared between tenants',
      );
    });

    it('refuses a relative bind mount', () => {
      expect(problemsFor('services:\n  a:\n    image: nginx\n    volumes:\n      - ./data:/data\n')[0]).toContain(
        'host filesystem is shared between tenants',
      );
    });

    it('refuses the long-form bind mount too', () => {
      expect(
        problemsFor(`
services:
  a:
    image: nginx
    volumes:
      - type: bind
        source: /var/run/docker.sock
        target: /var/run/docker.sock
`)[0],
      ).toContain('not supported');
    });

    it('refuses an external network, which would reach another tenant', () => {
      expect(
        problemsFor(`
services:
  a:
    image: nginx
    networks: [shared]
networks:
  shared:
    external: true
`)[0],
      ).toContain('may only use networks it owns');
    });

    it('refuses a host-interface port binding', () => {
      expect(problemsFor('services:\n  a:\n    image: nginx\n    ports:\n      - "127.0.0.1:8080:80"\n')[0]).toContain(
        'binds a specific host interface',
      );
    });
  });
});

describe('parseMemoryString', () => {
  it.each([
    ['512m', 512 * 1024 * 1024],
    ['1g', 1024 ** 3],
    ['1.5g', Math.floor(1.5 * 1024 ** 3)],
    ['2048', 2048],
    ['256M', 256 * 1024 * 1024],
    [1024, 1024],
  ])('parses %s', (input, expected) => {
    expect(parseMemoryString(input)).toBe(expected);
  });

  it('returns null for nonsense', () => {
    expect(parseMemoryString('lots')).toBeNull();
  });
});
