import { describe, it, expect } from '@jest/globals';
import yaml from 'js-yaml';
import { randomUUID } from 'crypto';
import {
  normalizeCompose,
  ComposeNormalizeError,
  expandVariables,
  collectVariableNames,
  generateForPlaceholder,
  stackProjectName,
  stackContainerName,
  slugify,
} from '../../src/services/compose/normalize';
import { buildTraefikLabels, buildAppLabels, makeContainerName } from '../../src/services/docker/primitives';
import { GS_LABELS } from '../../src/services/docker/client';

const SIMPLE = `
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

function render(overrides: Partial<Parameters<typeof normalizeCompose>[0]> = {}) {
  const { service, composeFile, ...rest } = overrides;
  return normalizeCompose({
    ...rest,
    service: {
      id: '11111111-2222-3333-4444-555555555555',
      serviceName: 'my-stack',
      projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      environment: {},
      domains: {},
      ...(service ?? {}),
    },
    composeFile: composeFile ?? SIMPLE,
  } as Parameters<typeof normalizeCompose>[0]);
}

function asDocument(composeResolved: string): any {
  return yaml.load(composeResolved);
}

describe('normalizeCompose', () => {
  describe('namespacing', () => {
    it('names the project, containers, network and volumes from the stack id', () => {
      const result = render();
      expect(result.project).toBe('gs-svc-my-stack-11111111');

      const doc = asDocument(result.composeResolved);
      expect(doc.services.web.container_name).toBe('gs-svc-my-stack-11111111-web');
      expect(doc.services.db.container_name).toBe('gs-svc-my-stack-11111111-db');
      expect(doc.volumes.pgdata.name).toBe('gs-svc-my-stack-11111111_pgdata');
      expect(doc.networks.default.name).toBe('gs-svc-my-stack-11111111_default');

      expect(result.volumes).toEqual([
        {
          composeVolumeName: 'pgdata',
          volumeName: 'gs-svc-my-stack-11111111_pgdata',
          managed: true,
        },
      ]);
    });

    it('leaves the mount referring to the Compose-local volume key', () => {
      // The rename happens once, in the top-level `volumes:` block. Doing it in
      // both places gives them two chances to disagree.
      const doc = asDocument(render().composeResolved);
      expect(doc.services.db.volumes).toEqual(['pgdata:/var/lib/postgresql/data']);
    });

    it('stamps every container, volume and network with the stack id label', () => {
      const result = render();
      const doc = asDocument(result.composeResolved);

      for (const svc of ['web', 'db']) {
        expect(doc.services[svc].labels[GS_LABELS.SERVICE_ID]).toBe('11111111-2222-3333-4444-555555555555');
        expect(doc.services[svc].labels[GS_LABELS.TYPE]).toBe('service');
        expect(doc.services[svc].labels[GS_LABELS.MANAGED]).toBe('true');
        expect(doc.services[svc].labels[GS_LABELS.COMPOSE_SERVICE]).toBe(svc);
        expect(doc.services[svc].labels[GS_LABELS.PROJECT_ID]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      }
      expect(doc.volumes.pgdata.labels[GS_LABELS.SERVICE_ID]).toBe('11111111-2222-3333-4444-555555555555');
      expect(doc.networks.default.labels[GS_LABELS.SERVICE_ID]).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('does not let a Compose file overwrite the platform labels', () => {
      // Otherwise a stack could claim another stack's id and be reaped by that
      // stack's delete, or claim `gs.type=application` and hide from stack views.
      const victim = randomUUID();
      const result = render({
        composeFile: `
services:
  web:
    image: nginx
    labels:
      ${GS_LABELS.SERVICE_ID}: "${victim}"
      ${GS_LABELS.MANAGED}: "false"
      ${GS_LABELS.TYPE}: application
      my.own.label: keep-me
`,
      });
      const labels = asDocument(result.composeResolved).services.web.labels;
      expect(labels[GS_LABELS.SERVICE_ID]).toBe('11111111-2222-3333-4444-555555555555');
      expect(labels[GS_LABELS.MANAGED]).toBe('true');
      expect(labels[GS_LABELS.TYPE]).toBe('service');
      // User labels that are not ours survive untouched.
      expect(labels['my.own.label']).toBe('keep-me');
    });

    it('gives two stacks with the same name entirely disjoint resource names', () => {
      const a = normalizeCompose({
        service: { id: randomUUID(), serviceName: 'wordpress', environment: {}, domains: {} },
        composeFile: SIMPLE,
      });
      const b = normalizeCompose({
        service: { id: randomUUID(), serviceName: 'wordpress', environment: {}, domains: {} },
        composeFile: SIMPLE,
      });

      expect(a.project).not.toBe(b.project);

      const namesOf = (r: typeof a) => {
        const doc = asDocument(r.composeResolved);
        return new Set<string>([
          r.project,
          ...Object.values<any>(doc.services).map((s) => s.container_name),
          ...Object.values<any>(doc.volumes ?? {}).map((v) => v.name),
          ...Object.values<any>(doc.networks).map((n) => n.name),
        ]);
      };

      const aNames = namesOf(a);
      const bNames = namesOf(b);
      for (const name of aNames) expect(bNames.has(name)).toBe(false);
      // The shared external proxy network is the only thing stacks share, and
      // neither of these stacks has a domain, so it is not present here.
      expect(aNames.size).toBe(bNames.size);
    });

    /**
     * The isolation claim, stated as an attack rather than an assertion.
     *
     * An attacker who can pick their stack's display name AND every Compose
     * service name inside it tries to make one of their container names equal a
     * victim stack's container name. If they could, `docker compose up` would
     * either fail their deploy or — worse, once names are reused for lookup —
     * let them address the victim's container.
     *
     * They cannot, because the 8 hex characters between the slug and the
     * service name come from their own row's UUID, which they do not choose.
     */
    it('cannot be steered into producing another stack\'s container name', () => {
      const victimId = randomUUID();
      const victim = { id: victimId, serviceName: 'billing', environment: {}, domains: {} };
      const victimProject = stackProjectName(victim);
      const victimNames = new Set(
        ['web', 'db', 'redis', 'worker'].map((s) => stackContainerName(victimProject, s)),
      );
      victimNames.add(victimProject);

      const victimShort = victimId.replace(/-/g, '').slice(0, 8);

      // Names crafted with full knowledge of the victim's project name.
      const attackerServiceNames = [
        'billing',
        victimProject,
        victimProject.replace('gs-svc-', ''),
        `billing-${victimShort}`,
        `billing-${victimShort}-web`,
        `${victimProject}-web`,
      ];
      const attackerComposeServiceNames = ['web', 'db', victimShort, `${victimShort}-web`, 'billing'];

      for (const serviceName of attackerServiceNames) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const attacker = { id: randomUUID(), serviceName, environment: {}, domains: {} };
          const project = stackProjectName(attacker);
          expect(victimNames.has(project)).toBe(false);
          for (const compose of attackerComposeServiceNames) {
            expect(victimNames.has(stackContainerName(project, compose))).toBe(false);
          }
        }
      }
    });

    /**
     * The same claim against the application deploy path.
     *
     * Applications name containers `gs-<appName>-<8 hex of deployment id>` with
     * an optional suffix. A stack must never produce one of those, and — the
     * part that actually matters — a delete filtered on `gs.service.id` must
     * never match an application container, because applications do not carry
     * that label at all.
     */
    it('cannot produce an application container name, and applications carry no stack label', () => {
      const appNames = ['billing', 'svc-billing', 'gs-svc-billing', 'my-stack'];
      const appContainerNames = new Set<string>();
      for (const appName of appNames) {
        for (let i = 0; i < 25; i++) {
          const deploymentId = randomUUID();
          appContainerNames.add(makeContainerName(appName, deploymentId));
          appContainerNames.add(makeContainerName(appName, deploymentId, 'candidate'));
        }
      }

      for (const serviceName of appNames) {
        for (let i = 0; i < 25; i++) {
          const stack = { id: randomUUID(), serviceName, environment: {}, domains: {} };
          const project = stackProjectName(stack);
          expect(appContainerNames.has(project)).toBe(false);
          for (const compose of ['web', 'db', 'candidate']) {
            expect(appContainerNames.has(stackContainerName(project, compose))).toBe(false);
          }
        }
      }

      // Label-space isolation: this is what makes deletion safe.
      const appLabels = buildAppLabels({
        applicationId: randomUUID(),
        appName: 'billing',
        deploymentId: randomUUID(),
        projectId: randomUUID(),
      });
      expect(appLabels[GS_LABELS.SERVICE_ID]).toBeUndefined();
      expect(appLabels[GS_LABELS.TYPE]).toBe('application');

      const stackLabels = asDocument(render().composeResolved).services.web.labels;
      expect(stackLabels[GS_LABELS.APP_ID]).toBeUndefined();
      expect(stackLabels[GS_LABELS.TYPE]).toBe('service');
    });

    it('slugifies a hostile display name into something DNS-safe', () => {
      expect(slugify('My Stack!! ../../etc')).toBe('my-stack-etc');
      expect(slugify('')).toBe('stack');
      expect(slugify('---')).toBe('stack');
      expect(slugify('a'.repeat(200))).toHaveLength(40);
    });

    it('refuses to namespace a stack whose id is too short to be unique', () => {
      expect(() =>
        normalizeCompose({
          service: { id: 'abc', serviceName: 'x', environment: {}, domains: {} },
          composeFile: SIMPLE,
        }),
      ).toThrow(/too short to namespace/);
    });
  });

  describe('Traefik label generation', () => {
    const DOMAIN_STACK = `
services:
  web:
    image: nginx
    expose: ["8080"]
  db:
    image: postgres:16
`;

    /**
     * Drift guard.
     *
     * The stack path and the application path must produce byte-identical
     * Traefik labels for equivalent input, because Traefik merges routers by
     * name and DROPS any router whose definitions disagree — taking both
     * workloads down. This test compares the stack's output against the
     * application path's own generator, so a reimplementation inside
     * normalize.ts fails here rather than in production.
     */
    it('matches the application path exactly for equivalent input', () => {
      const result = render({ composeFile: DOMAIN_STACK, service: { domains: { web: ['app.example.com'] } } as any });
      const doc = asDocument(result.composeResolved);
      const actual = Object.fromEntries(
        Object.entries(doc.services.web.labels).filter(([k]) => k.startsWith('traefik.')),
      );

      const expected = buildTraefikLabels({
        appName: `${result.project}-web`,
        domains: ['app.example.com'],
        servicePort: 8080,
      }).labels;

      expect(actual).toEqual(expected);
      expect(Object.keys(actual).length).toBeGreaterThan(0);
    });

    it('produces the Cloudflare-tunnel branch when CLOUDFLARE_TUNNEL is set', () => {
      const tunnel = render({
        composeFile: DOMAIN_STACK,
        service: { domains: { web: ['app.example.com'] } } as any,
        env: { CLOUDFLARE_TUNNEL: 'true' } as NodeJS.ProcessEnv,
      });
      const labels = asDocument(tunnel.composeResolved).services.web.labels;
      const router = `${tunnel.project}-web`;

      expect(labels[`traefik.http.routers.${router}.entrypoints`]).toBe('web');
      expect(labels[`traefik.http.routers.${router}-secure.tls`]).toBeUndefined();

      expect(labels).toMatchObject(
        buildTraefikLabels({
          appName: router,
          domains: ['app.example.com'],
          servicePort: 8080,
          env: { CLOUDFLARE_TUNNEL: 'true' } as NodeJS.ProcessEnv,
        }).labels,
      );
    });

    it('produces the Let\'s Encrypt branch by default', () => {
      const result = render({ composeFile: DOMAIN_STACK, service: { domains: { web: ['app.example.com'] } } as any });
      const labels = asDocument(result.composeResolved).services.web.labels;
      expect(labels[`traefik.http.routers.${result.project}-web-secure.tls.certresolver`]).toBe('letsencrypt');
    });

    it('gives each stack a distinct Traefik router name', () => {
      const a = normalizeCompose({
        service: { id: randomUUID(), serviceName: 'shop', environment: {}, domains: { web: ['a.example.com'] } },
        composeFile: DOMAIN_STACK,
      });
      const b = normalizeCompose({
        service: { id: randomUUID(), serviceName: 'shop', environment: {}, domains: { web: ['b.example.com'] } },
        composeFile: DOMAIN_STACK,
      });

      const routers = (r: typeof a) =>
        Object.keys(asDocument(r.composeResolved).services.web.labels).filter((k) => k.startsWith('traefik.http.routers.'));

      expect(routers(a).some((k) => routers(b).includes(k))).toBe(false);
    });

    it('joins the shared proxy network only for services that have a domain', () => {
      const result = render({ composeFile: DOMAIN_STACK, service: { domains: { web: ['app.example.com'] } } as any });
      const doc = asDocument(result.composeResolved);
      expect(doc.services.web.networks).toContain('guildserver');
      expect(doc.services.db.networks).not.toContain('guildserver');
      expect(doc.networks.guildserver).toEqual({ name: 'guildserver', external: true });
    });

    it('adds no Traefik labels and no external network when nothing has a domain', () => {
      const result = render();
      const doc = asDocument(result.composeResolved);
      expect(Object.keys(doc.services.web.labels).some((k) => k.startsWith('traefik.'))).toBe(false);
      expect(doc.networks.guildserver).toBeUndefined();
    });

    it('refuses a domain on a service with no routable port rather than guessing one', () => {
      expect(() =>
        render({ composeFile: DOMAIN_STACK, service: { domains: { db: ['db.example.com'] } } as any }),
      ).toThrow(/no port to route to/);
    });

    it('routes using template defaultPort when templateId is provided on a service without explicit port', () => {
      const result = render({
        composeFile: `
services:
  convertx:
    image: ghcr.io/c4illin/convertx:latest
`,
        service: {
          id: randomUUID(),
          serviceName: 'convertx',
          templateId: 'convertx',
          domains: { convertx: ['convertx.example.com'] },
        } as any,
      });
      const doc = asDocument(result.composeResolved);
      expect(doc.services.convertx.expose).toEqual(['3000']);
      const labels = doc.services.convertx.labels;
      expect(labels[`traefik.http.services.${result.project}-convertx.loadbalancer.server.port`]).toBe('3000');
    });
  });

  describe('variable expansion', () => {
    it('expands ${VAR} from the stack environment', () => {
      const doc = asDocument(
        render({
          composeFile: 'services:\n  web:\n    image: nginx:${TAG}\n',
          service: { environment: { TAG: '1.27' } } as any,
        }).composeResolved,
      );
      expect(doc.services.web.image).toBe('nginx:1.27');
    });

    it('honours ${VAR:-default} and ${VAR-default}', () => {
      const doc = asDocument(
        render({
          composeFile:
            'services:\n  a:\n    image: nginx:${TAG:-latest}\n  b:\n    image: redis:${RTAG-7}\n  c:\n    image: pg:${SET:-fallback}\n',
          service: { environment: { SET: '16' } } as any,
        }).composeResolved,
      );
      expect(doc.services.a.image).toBe('nginx:latest');
      expect(doc.services.b.image).toBe('redis:7');
      expect(doc.services.c.image).toBe('pg:16');
    });

    it('treats an empty value as unset for the `:-` form but not the `-` form', () => {
      const missing = new Set<string>();
      expect(expandVariables('${A:-fallback}', { A: '' }, missing)).toBe('fallback');
      expect(expandVariables('${A-fallback}', { A: '' }, missing)).toBe('');
      expect(missing.size).toBe(0);
    });

    it('expands the bare $VAR form', () => {
      const missing = new Set<string>();
      expect(expandVariables('postgres://$USER@db', { USER: 'app' }, missing)).toBe('postgres://app@db');
    });

    it('preserves $$ as a literal-dollar escape', () => {
      const missing = new Set<string>();
      expect(expandVariables('cost is $$5 and ${A}', { A: 'x' }, missing)).toBe('cost is $$5 and x');
      expect(missing.size).toBe(0);
    });

    it('escapes dollars inside substituted values so the CLI\'s second pass cannot eat them', () => {
      // `docker compose` interpolates the file we hand it again. An unescaped
      // `$` in a password would be silently swallowed there, and the container
      // would be initialised with a different password than the one we stored.
      const missing = new Set<string>();
      expect(expandVariables('${PW}', { PW: 'a$bc' }, missing)).toBe('a$$bc');
    });

    it('rejects an unset variable that has no default, naming every one of them', () => {
      let error: any;
      try {
        render({ composeFile: 'services:\n  a:\n    image: ${IMG}\n    command: ${CMD}\n' });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ComposeNormalizeError);
      expect(error.problems).toHaveLength(2);
      expect(error.problems.join('\n')).toContain('${CMD} is not set and has no default');
      expect(error.problems.join('\n')).toContain('${IMG} is not set and has no default');
    });

    it('treats the ${VAR:?msg} required form as missing when unset', () => {
      const missing = new Set<string>();
      expandVariables('${NEEDED:?you must set this}', {}, missing);
      expect([...missing]).toEqual(['NEEDED']);
    });

    it('collects variable names, ignoring $$ escapes', () => {
      expect(collectVariableNames('${A} $B ${C:-d} $$NOT_A_VAR').sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('generated credentials', () => {
    it('generates values for the SERVICE_* placeholder vocabulary and records them', () => {
      const result = render({
        composeFile: `
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: \${SERVICE_USER_POSTGRES}
      POSTGRES_PASSWORD: \${SERVICE_PASSWORD_POSTGRES}
      SESSION_KEY: \${SERVICE_BASE64_64_SESSION}
      NODE_ID: \${SERVICE_HEX_NODE}
`,
      });

      expect(Object.keys(result.generatedEnvironment).sort()).toEqual([
        'SERVICE_BASE64_64_SESSION',
        'SERVICE_HEX_NODE',
        'SERVICE_PASSWORD_POSTGRES',
        'SERVICE_USER_POSTGRES',
      ]);
      expect(result.generatedEnvironment.SERVICE_PASSWORD_POSTGRES).toHaveLength(32);
      expect(result.generatedEnvironment.SERVICE_USER_POSTGRES).toHaveLength(16);
      expect(Buffer.from(result.generatedEnvironment.SERVICE_BASE64_64_SESSION, 'base64')).toHaveLength(64);
      expect(result.generatedEnvironment.SERVICE_HEX_NODE).toMatch(/^[0-9a-f]{32}$/);

      const env = asDocument(result.composeResolved).services.db.environment;
      expect(env.POSTGRES_PASSWORD).toBe(result.generatedEnvironment.SERVICE_PASSWORD_POSTGRES);
    });

    it('honours a stored value rather than generating a new one', () => {
      // A redeploy must not invent a new password for a volume that was
      // initialised with the old one.
      const result = render({
        composeFile: 'services:\n  db:\n    image: postgres\n    environment:\n      P: ${SERVICE_PASSWORD_DB}\n',
        service: { environment: { SERVICE_PASSWORD_DB: 'already-chosen' } } as any,
      });
      expect(result.generatedEnvironment).toEqual({});
      expect(asDocument(result.composeResolved).services.db.environment.P).toBe('already-chosen');
    });

    it('refuses to invent a value for a credential the user must supply', () => {
      // Generating 32 random characters for STRIPE_API_KEY would produce a
      // stack that starts cleanly and fails every payment.
      expect(generateForPlaceholder('STRIPE_API_KEY')).toBeNull();
      expect(generateForPlaceholder('POSTGRES_PASSWORD')).toBeNull();
      expect(generateForPlaceholder('DATABASE_URL')).toBeNull();
      expect(() =>
        render({ composeFile: 'services:\n  a:\n    image: nginx\n    environment:\n      K: ${STRIPE_API_KEY}\n' }),
      ).toThrow(/STRIPE_API_KEY/);
    });
  });

  describe('the rest of the document', () => {
    it('preserves depends_on ordering', () => {
      const doc = asDocument(
        render({
          composeFile: `
services:
  web:
    image: nginx
    depends_on: [db, cache]
  db:
    image: postgres
  cache:
    image: redis
`,
        }).composeResolved,
      );
      expect(doc.services.web.depends_on).toEqual(['db', 'cache']);
    });

    it('defaults restart to unless-stopped but honours an explicit policy', () => {
      const doc = asDocument(
        render({
          composeFile: 'services:\n  a:\n    image: nginx\n  b:\n    image: nginx\n    restart: "no"\n',
        }).composeResolved,
      );
      expect(doc.services.a.restart).toBe('unless-stopped');
      expect(doc.services.b.restart).toBe('no');
    });

    it('carries healthcheck, command, ports and resource limits through', () => {
      const doc = asDocument(
        render({
          composeFile: `
services:
  a:
    image: nginx
    command: ["nginx", "-g", "daemon off;"]
    ports:
      - "8080:80"
    healthcheck:
      test: ["CMD", "true"]
      interval: 5s
    deploy:
      resources:
        limits:
          memory: 256m
          cpus: "1.5"
`,
        }).composeResolved,
      );
      expect(doc.services.a.command).toEqual(['nginx', '-g', 'daemon off;']);
      expect(doc.services.a.ports).toEqual(['8080:80/tcp']);
      expect(doc.services.a.healthcheck).toEqual({ test: ['CMD', 'true'], interval: '5s' });
      expect(doc.services.a.deploy.resources.limits).toEqual({ memory: String(256 * 1024 * 1024), cpus: '1.5' });
    });

    it('rejects `build:` with a message that says what to do instead', () => {
      expect(() =>
        render({ composeFile: 'services:\n  a:\n    build: .\n' }),
      ).toThrow(/Publish the image to a registry/);
    });

    it('surfaces parse problems as normalisation problems', () => {
      let error: any;
      try {
        render({ composeFile: 'services:\n  a:\n    image: nginx\n    privileged: true\n' });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ComposeNormalizeError);
      expect(error.problems[0]).toContain('privileged');
    });

    it('emits no YAML anchors, which the compose CLI would have to resolve', () => {
      // Label objects are shared between services in memory; without noRefs the
      // dumper would emit `*ref_0` and the file would be harder to debug.
      expect(render().composeResolved).not.toContain('*ref_');
    });
  });
});
