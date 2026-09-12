jest.mock('@guildserver/database', () => ({
  db: { query: { applications: { findFirst: jest.fn() }, databases: { findFirst: jest.fn() }, services: { findFirst: jest.fn() }, projects: { findFirst: jest.fn() }, members: { findFirst: jest.fn() } } },
  applications: { id: 'id' }, databases: { id: 'id' }, services: { id: 'id' }, projects: { id: 'id' }, members: { organizationId: 'org', userId: 'user' },
}));
import { db } from '@guildserver/database';
import { authorizeTerminal, issueTerminalTicket, consumeTerminalTicket, assertTerminalContainer } from '../../src/services/container-terminal';
const target = { kind: 'application' as const, id: '11111111-1111-4111-8111-111111111111', shell: '/bin/sh' as const };
beforeEach(() => {
  jest.clearAllMocks();
  (db.query.applications.findFirst as jest.Mock).mockResolvedValue({ id: target.id, projectId: 'project', name: 'app', providerId: null });
  (db.query.projects.findFirst as jest.Mock).mockResolvedValue({ organizationId: 'org' });
  (db.query.members.findFirst as jest.Mock).mockResolvedValue({ role: 'owner' });
});
it('requires organization ownership/admin membership', async () => {
  (db.query.members.findFirst as jest.Mock).mockResolvedValue(null);
  await expect(authorizeTerminal('outsider', target)).rejects.toThrow(/owner or administrator/);
  (db.query.members.findFirst as jest.Mock).mockResolvedValue({ role: 'member' });
  await expect(authorizeTerminal('reader', target)).rejects.toThrow(/owner or administrator/);
});
it('does not resolve remote workloads against the local daemon', async () => {
  (db.query.applications.findFirst as jest.Mock).mockResolvedValue({ projectId: 'project', providerId: 'remote' });
  await expect(authorizeTerminal('owner', target)).rejects.toThrow(/remote host/);
});
it('consumes connection tickets exactly once', async () => {
  const { ticket } = await issueTerminalTicket('owner', target);
  expect(consumeTerminalTicket(ticket)?.target.id).toBe(target.id);
  expect(consumeTerminalTicket(ticket)).toBeNull();
});
it('expires connection tickets', async () => {
  const { ticket } = await issueTerminalTicket('owner', target);
  const now = Date.now(); const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 31000);
  expect(consumeTerminalTicket(ticket)).toBeNull(); spy.mockRestore();
});
it('rejects foreign labels, stopped containers and host mounts', () => {
  const info: any = { Config: { Labels: { 'gs.managed': 'true', 'gs.app.id': target.id } }, State: { Running: true }, HostConfig: {}, Mounts: [] };
  expect(() => assertTerminalContainer(info, target)).not.toThrow();
  expect(() => assertTerminalContainer({ ...info, Mounts: [{ Type: 'bind', Destination: '/var/run/docker.sock' }] }, target)).toThrow(/host-level/);
  expect(() => assertTerminalContainer({ ...info, State: { Running: false } }, target)).toThrow(/not running/);
  expect(() => assertTerminalContainer(info, { ...target, id: 'foreign' })).toThrow(/belongs/);
});
