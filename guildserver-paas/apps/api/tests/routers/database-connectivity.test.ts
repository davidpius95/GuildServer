jest.mock('../../src/services/db-backup', () => ({ DatabaseBackupService: {} }));
jest.mock('../../src/queues/backups', () => ({}));
jest.mock('../../src/services/database-provision', () => ({}));
jest.mock('../../src/services/docker/container', () => ({}));
import { databaseRouter } from '../../src/routers/database';

const id = '223abf8c-1ab0-4000-8000-000000000001';
const record = { id, type: 'postgresql', databaseName: 'app', username: 'owner', password: 'secret', externalPort: 12345, hostPort: 24996, projectId: 'project', project: { organization: { members: [{userId: 'user'}] } } };
function caller(database: any = record) {
  return databaseRouter.createCaller({ isAuthenticated: true, user: {id:'user'}, db: {query: {databases: {findFirst: async () => database}}} } as any);
}
it('defaults app connections to the internal DNS name and native port', async () => {
 const info = await caller().getConnectionInfo({id});
 expect(info.host).toBe('gs-db-223abf8c-1ab');
 expect(info.port).toBe(5432);
 expect(info.connectionString).toBe('postgresql://owner:***@gs-db-223abf8c-1ab:5432/app');
});
it('uses the actual published port for external connections', async () => {
 const info = await caller().getConnectionInfo({id, target:'external'} as any);
 expect(info.port).toBe(24996);
});
it('rejects connection information for inaccessible databases', async () => {
 await expect(caller({...record, project: {organization: {members:[]}}}).getConnectionInfo({id})).rejects.toMatchObject({code:'NOT_FOUND'});
});
import { decryptSecret } from '../../src/utils/crypto';
const appId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function connectCaller(overrides: any = {}) {
 let saved: any;
 const app = {id: appId, projectId:'project', deploymentTarget:'docker-local', project:{organization:{members:[{userId:'user'}]}}, ...overrides};
 const ctx = {isAuthenticated:true, user:{id:'user'}, db:{query:{databases:{findFirst:async()=>record}, applications:{findFirst:async()=>app}, environmentVariables:{findFirst:async()=>undefined}}, insert:()=>({values:(value:any)=>{saved=value;return Promise.resolve();}})}};
 return {caller: databaseRouter.createCaller(ctx as any), saved:()=>saved};
}
it('connects an app with an encrypted internal DATABASE_URL', async () => {
 const c=connectCaller();
 const result=await (c.caller as any).connectToApp({id,applicationId:appId});
 expect(result.redeployRequired).toBe(true);
 expect(c.saved().isSecret).toBe(true);
 expect(decryptSecret(c.saved().value)).toBe('postgresql://owner:secret@gs-db-223abf8c-1ab:5432/app');
 expect(JSON.stringify(result)).not.toContain('secret');
});
it.each([{projectId:'different'}, {deploymentTarget:'proxmox'}, {project:{organization:{members:[]}}}])('rejects incompatible or inaccessible app %j', async (overrides) => {
 const c=connectCaller(overrides);
 await expect((c.caller as any).connectToApp({id,applicationId:appId})).rejects.toThrow();
 expect(c.saved()).toBeUndefined();
});
