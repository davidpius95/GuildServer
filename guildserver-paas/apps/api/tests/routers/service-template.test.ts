import { eq } from 'drizzle-orm';
import { services } from '@guildserver/database';
import { SERVICE_TEMPLATES } from '@guildserver/database/dist/seed/service-templates';
import { declareNamedVolumes, deployableCatalogue } from '../../src/services/templates/catalogue';
import { db, testUtils } from '../setup';

const queueAdd = jest.fn(async () => ({ id: 'job-1' }));
jest.mock('../../src/queues/deployment', () => ({ deploymentQueue: { add: queueAdd } }));
jest.mock('../../src/websocket/server', () => ({ broadcastToUser: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { serviceTemplateRouter } = require('../../src/routers/service-template');

const context = (user: any) => ({
  db,
  req: {} as any,
  res: {} as any,
  user,
  isAuthenticated: !!user,
  isAdmin: false,
});

/** A publishable template that needs no user input and exposes a routed service. */
function simpleTemplate() {
  const { getServiceTemplateCompose } = require('@guildserver/database/dist/seed/service-template-compose');
  const { parseCompose } = require('../../src/services/compose/parse');
  const template = deployableCatalogue().templates.find((t) => {
    if (t.userVariables.some((v) => v.required)) return false;
    if (!t.variables.some((v) => v.kind === 'generated')) return false;
    const compose = getServiceTemplateCompose(t.id);
    const routed = parseCompose(declareNamedVolumes(compose)).services.filter((s: any) => s.expose.length > 0 || s.ports.length > 0).map((s: any) => s.name);
    return t.variables.some((v) => v.kind === 'domain' && v.targetService && routed.includes(v.targetService));
  });
  if (!template) throw new Error('no suitable template in the catalogue');
  return template;
}

async function tenant() {
  const user = await testUtils.createUser();
  const org = await testUtils.createOrganization(user.id);
  await testUtils.createMember(user.id, org.id, 'owner');
  const project = await testUtils.createProject(org.id);
  return { user, project };
}

describe('serviceTemplate router', () => {
  beforeEach(() => queueAdd.mockClear());

  it('lists only deployable, verified templates, without Compose bodies', async () => {
    const { user } = await tenant();
    const result = await serviceTemplateRouter.createCaller(context(user)).list();
    expect(result.total).toBe(deployableCatalogue().templates.length);
    expect(result.templates).toHaveLength(result.total);
    const unpublishable = SERVICE_TEMPLATES.find((t) => !t.publishable);
    if (unpublishable) expect(result.templates.some((t: any) => t.id === unpublishable.id)).toBe(false);
    expect(JSON.stringify(result.templates[0])).not.toMatch(/services:\s*\n/);
    expect(result.source.license).toBe('Apache-2.0');
  });

  it('filters by search text', async () => {
    const { user } = await tenant();
    const template = simpleTemplate();
    const result = await serviceTemplateRouter.createCaller(context(user)).list({ search: template.name });
    expect(result.templates.map((t: any) => t.id)).toContain(template.id);
  });

  it('refuses an unpublishable or unknown template', async () => {
    const { user } = await tenant();
    const caller = serviceTemplateRouter.createCaller(context(user));
    await expect(caller.get({ id: 'no-such-template' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const unpublishable = SERVICE_TEMPLATES.find((t) => !t.publishable);
    if (unpublishable) await expect(caller.get({ id: unpublishable.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('creates a stack with generated secrets and routed domains, then queues its deployment', async () => {
    const { user, project } = await tenant();
    const template = simpleTemplate();
    const result = await serviceTemplateRouter
      .createCaller(context(user))
      .deploy({ templateId: template.id, projectId: project.id, name: 'Catalogue Test' });

    const [stack] = await db.select().from(services).where(eq(services.id, result.stackId));
    expect(stack.templateId).toBe(template.id);
    const environment = stack.environment as Record<string, string>;
    const generated = template.variables.filter((v) => v.kind === 'generated');
    for (const variable of generated) expect(environment[variable.key]).toBeTruthy();
    const hosts = Object.values(stack.domains as Record<string, string[]>).flat();
    expect(hosts.length).toBeGreaterThan(0);
    // Hostnames carry a short random suffix so two stacks of the same template
    // in one project cannot claim the same domain.
    for (const host of hosts) expect(host).toMatch(/-catalogue-test-[0-9a-f]{4}\./);
    expect(result.urls.length).toBe(hosts.length);
    expect(result.deploymentId).toBeTruthy();
    expect(queueAdd).toHaveBeenCalledWith('deploy-service', expect.objectContaining({ serviceId: result.stackId }), expect.anything());
  });

  it('does not deploy when asked only to create', async () => {
    const { user, project } = await tenant();
    const result = await serviceTemplateRouter
      .createCaller(context(user))
      .deploy({ templateId: simpleTemplate().id, projectId: project.id, name: 'Create Only', deploy: false });
    expect(result.deploymentId).toBeNull();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("refuses to create a stack in another organization's project", async () => {
    const { user } = await tenant();
    const { project: otherProject } = await tenant();
    await expect(
      serviceTemplateRouter
        .createCaller(context(user))
        .deploy({ templateId: simpleTemplate().id, projectId: otherProject.id, name: 'Intruder' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects values for variables the template does not declare', async () => {
    const { user, project } = await tenant();
    await expect(
      serviceTemplateRouter.createCaller(context(user)).deploy({
        templateId: simpleTemplate().id,
        projectId: project.id,
        name: 'Override Attempt',
        values: { SERVICE_PASSWORD_ANYTHING: 'hunter2' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
