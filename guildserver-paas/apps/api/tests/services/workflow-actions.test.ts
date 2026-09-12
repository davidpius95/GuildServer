jest.mock('@guildserver/database', () => ({
 db: { query: { members: {findFirst: jest.fn()}, projects: {findFirst: jest.fn()}, applications:{findFirst:jest.fn()}, services:{findFirst:jest.fn()}, databases:{findFirst:jest.fn()}, users:{findFirst:jest.fn()}, deployments:{findFirst:jest.fn()}, databaseBackups:{findFirst:jest.fn()} } },
 members:{userId:'user',organizationId:'org'}, projects:{id:'id'}, applications:{id:'id'}, services:{id:'id'}, databases:{id:'id'}, users:{id:'id'}, deployments:{id:'id'}, databaseBackups:{id:'id'},
}));
jest.mock('../../src/trpc/router', () => ({appRouter:{createCaller:jest.fn()}}));
jest.mock('../../src/services/workflow-http', () => ({workflowHttp:jest.fn()}));
import { db } from '@guildserver/database';
import { appRouter } from '../../src/trpc/router';
import { workflowHttp } from '../../src/services/workflow-http';
import { runWorkflowAction } from '../../src/services/workflow-actions';
const step: any = {id:'deploy',name:'Deploy stack',type:'action',config:{action:'stack.deploy',resourceId:'stack'}};
const scope = {organizationId:'org',triggeredBy:'owner'};
beforeEach(()=>{
 jest.clearAllMocks();
 (db.query.members.findFirst as jest.Mock).mockResolvedValue({role:'owner'});
 (db.query.projects.findFirst as jest.Mock).mockResolvedValue({organizationId:'org'});
 (db.query.services.findFirst as jest.Mock).mockResolvedValue({projectId:'project'});
 (db.query.users.findFirst as jest.Mock).mockResolvedValue({id:'owner',role:'user'});
});
it('does not deploy a resource from another organization',async()=>{
 (db.query.projects.findFirst as jest.Mock).mockResolvedValue({organizationId:'other'});
 await expect(runWorkflowAction(step,{},scope,async()=>{})).rejects.toThrow(/not found/);
 expect(appRouter.createCaller).not.toHaveBeenCalled();
});
it('does not run resource actions after membership is revoked',async()=>{
 (db.query.members.findFirst as jest.Mock).mockResolvedValue(null);
 await expect(runWorkflowAction(step,{},scope,async()=>{})).rejects.toThrow(/owner or administrator/);
});
it('persists the queued operation and reports an actual deployment failure',async()=>{
 const deploy=jest.fn().mockResolvedValue({id:'operation'});
 (appRouter.createCaller as jest.Mock).mockReturnValue({service:{deploy}});
 (db.query.deployments.findFirst as jest.Mock).mockResolvedValue({status:'failed'});
 const context:any={};const persist=jest.fn();
 await expect(runWorkflowAction(step,context,scope,persist)).rejects.toThrow(/failed/);
 expect(context.step_deploy).toMatchObject({operationId:'operation',status:'failed'});
 expect(persist).toHaveBeenCalledTimes(1);
});
it('resumes a persisted operation without creating another deployment',async()=>{
 const deploy=jest.fn();(appRouter.createCaller as jest.Mock).mockReturnValue({service:{deploy}});
 (db.query.deployments.findFirst as jest.Mock).mockResolvedValue({status:'success'});
 const context:any={step_deploy:{operationId:'existing',status:'running'}};
 await runWorkflowAction(step,context,scope,async()=>{});
 expect(deploy).not.toHaveBeenCalled();expect(context.step_deploy.status).toBe('completed');
});
it('fails the workflow on non-success HTTP responses',async()=>{
 (workflowHttp as jest.Mock).mockResolvedValue(503);
 await expect(runWorkflowAction({...step,config:{action:'http',url:'https://example.com'}},{},scope,async()=>{})).rejects.toThrow(/503/);
});
