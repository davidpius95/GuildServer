/**
 * Planning stacks from catalogue templates. Pure: no database, no Docker.
 */
import {
  PUBLISHABLE_SERVICE_TEMPLATES,
  type ServiceTemplate,
} from '@guildserver/database/dist/seed/service-templates';
import { getServiceTemplateCompose } from '@guildserver/database/dist/seed/service-template-compose';
import * as yaml from 'js-yaml';
import { parseCompose } from '../../src/services/compose/parse';
import {
  declareNamedVolumes,
  deployableCatalogue,
  exposeDomainPorts,
  planTemplateStack,
  TemplateInputError,
  toCatalogueEntry,
} from '../../src/services/templates/catalogue';

const COMPOSE = `
services:
  web:
    image: ghost:5
    expose: ["2368"]
    environment:
      url: \${SERVICE_URL_WEB}
      database__connection__password: \${SERVICE_PASSWORD_MYSQL}
      admin_email: \${ADMIN_EMAIL}
      site_name: \${SITE_NAME:-demo}
  mysql:
    image: mysql:8
    environment:
      MYSQL_PASSWORD: \${SERVICE_PASSWORD_MYSQL}
      MYSQL_HOST_ALIAS: \${SERVICE_FQDN_MYSQL}
`;

const TEMPLATE: ServiceTemplate = {
  id: 'ghost-test',
  name: 'Ghost (test)',
  description: 'Publishing platform',
  category: 'cms',
  tags: ['blog'],
  documentationUrl: null,
  logo: null,
  defaultPort: 2368,
  extraPorts: null,
  notices: [],
  services: [
    { name: 'web', image: 'ghost:5', hasHealthcheck: false, ports: [2368], oneShot: false },
    { name: 'mysql', image: 'mysql:8', hasHealthcheck: false, ports: [], oneShot: false },
  ],
  variables: [
    { key: 'SERVICE_URL_WEB', kind: 'domain', format: 'url', serviceName: 'web', port: 2368, targetService: 'web', resolution: 'exact' },
    { key: 'SERVICE_FQDN_MYSQL', kind: 'domain', format: 'fqdn', serviceName: 'mysql', port: null, targetService: 'mysql', resolution: 'exact' },
    { key: 'SERVICE_PASSWORD_MYSQL', kind: 'generated', generator: { kind: 'password', length: 32 }, identifier: 'MYSQL' },
  ],
  userVariables: [
    { key: 'ADMIN_EMAIL', required: true, defaultValue: null },
    { key: 'SITE_NAME', required: false, defaultValue: 'demo' },
  ],
  publishable: true,
  verification: 'passed',
  warnings: [],
  upstreamPath: 'templates/compose/ghost.yaml',
};

const options = (overrides: Partial<Parameters<typeof planTemplateStack>[2]> = {}) => ({
  stackSlug: 'my-blog',
  baseDomain: 'guild-technologies.com',
  https: true,
  userValues: { ADMIN_EMAIL: 'owner@example.com' },
  ...overrides,
});

describe('planTemplateStack', () => {
  it('routes a public URL to each service that publishes a port', () => {
    const plan = planTemplateStack(TEMPLATE, COMPOSE, options());
    expect(plan.domains).toEqual({ web: ['web-my-blog.guild-technologies.com'] });
    expect(plan.urls).toEqual([{ service: 'web', url: 'https://web-my-blog.guild-technologies.com' }]);
    expect(plan.environment.SERVICE_URL_WEB).toBe('https://web-my-blog.guild-technologies.com');
  });

  it('routes a service whose domain variable names its port, even if the file publishes none', () => {
    const template = {
      ...TEMPLATE,
      variables: TEMPLATE.variables.map((v) => (v.kind === 'domain' && v.targetService === 'mysql' ? { ...v, port: 3306 } : v)),
    } as ServiceTemplate;
    const plan = planTemplateStack(template, COMPOSE, options());
    expect(plan.domains.mysql).toEqual(['mysql-my-blog.guild-technologies.com']);
    expect(plan.warnings).toEqual([]);
  });

  it('gives a service with no known port a hostname but no route, and says so', () => {
    const plan = planTemplateStack(TEMPLATE, COMPOSE, options());
    expect(plan.domains.mysql).toBeUndefined();
    expect(plan.environment.SERVICE_FQDN_MYSQL).toBe('mysql-my-blog.guild-technologies.com');
    expect(plan.warnings).toEqual([expect.stringContaining('"mysql" does not publish a port')]);
  });

  it('generates each secret once, so every service sharing it agrees', () => {
    const plan = planTemplateStack(TEMPLATE, COMPOSE, options());
    expect(plan.environment.SERVICE_PASSWORD_MYSQL).toMatch(/^.{32}$/);
    const again = planTemplateStack(TEMPLATE, COMPOSE, options());
    expect(again.environment.SERVICE_PASSWORD_MYSQL).not.toBe(plan.environment.SERVICE_PASSWORD_MYSQL);
  });

  it('pins user values and defaults into the environment', () => {
    const plan = planTemplateStack(TEMPLATE, COMPOSE, options());
    expect(plan.environment.ADMIN_EMAIL).toBe('owner@example.com');
    expect(plan.environment.SITE_NAME).toBe('demo');
    const custom = planTemplateStack(TEMPLATE, COMPOSE, options({ userValues: { ADMIN_EMAIL: 'a@b.c', SITE_NAME: 'Mine' } }));
    expect(custom.environment.SITE_NAME).toBe('Mine');
  });

  it('keeps the Compose body uninterpolated, for the stack deploy to interpolate', () => {
    const plan = planTemplateStack(TEMPLATE, COMPOSE, options());
    expect(plan.composeFile).toBe(COMPOSE);
    expect(plan.composeFile).toContain('${SERVICE_PASSWORD_MYSQL}');
  });

  it('uses http URLs when asked', () => {
    const plan = planTemplateStack(TEMPLATE, COMPOSE, options({ https: false, baseDomain: 'guildserver.localhost' }));
    expect(plan.urls[0].url).toBe('http://web-my-blog.guildserver.localhost');
  });

  it('rejects a missing required value, naming it', () => {
    expect(() => planTemplateStack(TEMPLATE, COMPOSE, options({ userValues: { ADMIN_EMAIL: '  ' } }))).toThrow(
      expect.objectContaining({ name: 'TemplateInputError', fields: ['ADMIN_EMAIL'] }),
    );
  });

  it('rejects variables the template does not declare, so generated secrets cannot be overridden', () => {
    let error: unknown;
    try {
      planTemplateStack(TEMPLATE, COMPOSE, options({ userValues: { ADMIN_EMAIL: 'a@b.c', SERVICE_PASSWORD_MYSQL: 'hunter2' } }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TemplateInputError);
    expect((error as TemplateInputError).fields).toEqual(['SERVICE_PASSWORD_MYSQL']);
  });
});

describe('toCatalogueEntry', () => {
  it('lists the public services and user variables, and no Compose body or secrets', () => {
    const entry = toCatalogueEntry(TEMPLATE);
    expect(entry.publicServices).toEqual(['web', 'mysql']);
    expect(entry.userVariables).toEqual([
      { key: 'ADMIN_EMAIL', required: true, defaultValue: null },
      { key: 'SITE_NAME', required: false, defaultValue: 'demo' },
    ]);
    expect(JSON.stringify(entry)).not.toContain('SERVICE_PASSWORD');
  });
});

describe('declareNamedVolumes', () => {
  it('declares named volumes a service mounts but the file does not, and nothing else', () => {
    const body = `services:\n  app:\n    image: x\n    volumes:\n      - data:/data\n      - ./local:/local\n      - /host:/host\n      - \${HOME}/x:/x\n      - type: volume\n        source: cache\n        target: /cache\nvolumes:\n  other: {}\n`;
    const doc = yaml.load(declareNamedVolumes(body)) as { volumes: Record<string, unknown> };
    expect(Object.keys(doc.volumes).sort()).toEqual(['cache', 'data', 'other']);
  });

  it('leaves a file that declares everything untouched', () => {
    const body = `services:\n  app:\n    image: x\n    volumes:\n      - data:/data\nvolumes:\n  data:\n`;
    expect(declareNamedVolumes(body)).toBe(body);
  });
});

describe('exposeDomainPorts', () => {
  const domain = (targetService: string, port: number | null) => ({
    key: `SERVICE_URL_${targetService.toUpperCase()}`,
    kind: 'domain' as const,
    format: 'url' as const,
    serviceName: targetService,
    port,
    targetService,
    resolution: 'exact' as const,
  });

  it('exposes the port a domain variable names when the service publishes none', () => {
    const body = `services:\n  kuma:\n    image: louislam/uptime-kuma:2\n`;
    const doc = yaml.load(exposeDomainPorts(body, [domain('kuma', 3001)])) as any;
    expect(doc.services.kuma.expose).toEqual(['3001']);
  });

  it('leaves a service that already publishes a port, or a variable with no port, alone', () => {
    const body = `services:\n  web:\n    image: x\n    expose: ["8080"]\n  worker:\n    image: y\n`;
    expect(exposeDomainPorts(body, [domain('web', 3000), domain('worker', null)])).toBe(body);
  });
});

describe('the deployable catalogue', () => {
  it('offers most verified templates, and only verified ones', () => {
    const { templates, excluded } = deployableCatalogue();
    expect(templates.length).toBeGreaterThanOrEqual(150);
    expect(templates.every((t) => t.publishable && t.verification === 'passed')).toBe(true);
    expect(templates.length + excluded.length).toBe(PUBLISHABLE_SERVICE_TEMPLATES.length);
    for (const exclusion of excluded) expect(exclusion.reason.length).toBeGreaterThan(0);
  });

  it('leaves out templates the stack deployer refuses, with the reason', () => {
    const { excluded } = deployableCatalogue();
    const capAdd = excluded.find((e) => e.reason.includes('cap_add'));
    if (PUBLISHABLE_SERVICE_TEMPLATES.some((t) => t.id === 'pi-hole')) {
      expect(capAdd).toBeDefined();
    }
  });

  it('gives Uptime Kuma a routed public URL', () => {
    const template = deployableCatalogue().templates.find((t) => t.id === 'uptime-kuma');
    if (!template) return;
    const plan = planTemplateStack(template, getServiceTemplateCompose('uptime-kuma')!, {
      stackSlug: 'kuma', baseDomain: 'example.com', https: true, userValues: {},
    });
    expect(plan.urls.map((u) => u.url)).toContain('https://uptime-kuma-kuma.example.com');
  });

  it('plans every offered template with a routed URL only for services that exist', () => {
    const failures: string[] = [];
    for (const template of deployableCatalogue().templates) {
      const compose = getServiceTemplateCompose(template.id)!;
      const userValues = Object.fromEntries(
        template.userVariables.filter((v) => v.required).map((v) => [v.key, 'catalogue-test-value']),
      );
      const plan = planTemplateStack(template, compose, { stackSlug: 'catalogue-test', baseDomain: 'example.com', https: true, userValues });
      const services = new Set(parseCompose(plan.composeFile).services.map((s) => s.name));
      for (const service of Object.keys(plan.domains)) {
        if (!services.has(service)) failures.push(`${template.id}: domain for unknown service ${service}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
