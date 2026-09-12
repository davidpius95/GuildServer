/** Explicitly opt-in production smoke: creates only prefixed, temporary resources. */
import { randomBytes } from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";
import superjson from "superjson";
import { db, users, organizations, members, projects } from "@guildserver/database";
import { eq } from "drizzle-orm";
const statePath = "/tmp/guildserver-operations-smoke.json";
const phase = process.argv[2];
if (process.env.GS_OPERATIONS_SMOKE !== "1") throw new Error("Set GS_OPERATIONS_SMOKE=1 for this bounded live smoke test.");
const save = (state: any) => fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
async function call(state: any, route: string, input: any, mutation = false) {
  const encoded = JSON.stringify(superjson.serialize(input));
  const response = await fetch(`http://127.0.0.1:4000/trpc/${route}${mutation ? "" : `?input=${encodeURIComponent(encoded)}`}`, { method: mutation ? "POST" : "GET", headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, body: mutation ? encoded : undefined });
  const body: any = await response.json();
  if (!response.ok || body.error) throw new Error(`${route}: ${JSON.stringify(body.error)}`);
  return superjson.deserialize<any>(body.result.data);
}
async function main() {
  if (phase === "setup") {
    if (fs.existsSync(statePath)) throw new Error("Reconcile the existing smoke state first.");
    const suffix = Date.now().toString(36);
    const [user] = await db.insert(users).values({ email: `ops-smoke-${suffix}@example.invalid`, name: "Operations verification" }).returning();
    const [org] = await db.insert(organizations).values({ name: `ops-smoke-${suffix}`, slug: `ops-smoke-${suffix}`, ownerId: user.id }).returning();
    await db.insert(members).values({ userId: user.id, organizationId: org.id, role: "owner" });
    const [project] = await db.insert(projects).values({ name: `ops-smoke-${suffix}`, organizationId: org.id }).returning();
    const state: any = { userId: user.id, orgId: org.id, projectId: project.id, suffix, token: jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: "4h" }), password: randomBytes(24).toString("hex"), stacks: [], databases: [], workflows: [] };
    save(state); console.log(JSON.stringify({ phase, projectId: project.id })); return;
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (phase === "stack") {
    const script = `const http=require('http'),net=require('net');http.createServer(async(q,r)=>{try{await Promise.all(['postgres:5432','redis:6379'].map(a=>new Promise((yes,no)=>{const[h,p]=a.split(':');const s=net.connect(+p,h,()=>{s.end();yes()});s.on('error',no);s.setTimeout(3000,()=>{s.destroy();no(Error('timeout'))})})));r.end('stack-network-ok')}catch(e){r.statusCode=503;r.end('dependency-unavailable')}}).listen(8080,'0.0.0.0')`;
    const composeFile = `services:\n  web:\n    image: node:20-alpine\n    command: ["node", "-e", ${JSON.stringify(script)}]\n    expose: ["8080"]\n    depends_on:\n      postgres:\n        condition: service_healthy\n      redis:\n        condition: service_healthy\n    deploy:\n      resources:\n        limits:\n          memory: 128M\n  postgres:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: ${state.password}\n      POSTGRES_DB: smoke\n    volumes: ["pgdata:/var/lib/postgresql/data"]\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres -d smoke"]\n      interval: 2s\n      timeout: 2s\n      retries: 30\n    deploy:\n      resources:\n        limits:\n          memory: 256M\n  redis:\n    image: redis:7-alpine\n    healthcheck:\n      test: ["CMD", "redis-cli", "ping"]\n      interval: 2s\n      timeout: 2s\n      retries: 30\n    deploy:\n      resources:\n        limits:\n          memory: 128M\nvolumes:\n  pgdata:\n`;
    const host = `ops-smoke-${state.suffix}.${process.env.BASE_DOMAIN}`;
    const stack = await call(state, "service.create", { name: `ops-smoke-${state.suffix}`, projectId: state.projectId, composeFile, domains: { web: [host] } }, true);
    state.stacks.push(stack.id); state.stackUrl = `https://${host}`; save(state);
    const deployment = await call(state, "service.deploy", { id: stack.id }, true);
    console.log(JSON.stringify({ phase, stackId: stack.id, deploymentId: deployment.id, url: state.stackUrl }));
  } else if (phase === "status") {
    for (const id of state.stacks) { const stack = await call(state, "service.getById", { id }); console.log(JSON.stringify({ stackId: id, status: stack.status })); console.log(JSON.stringify(await call(state, "service.status", { id }))); }
    for (const id of state.databases) { const database = await call(state, "database.getById", { id }); console.log(JSON.stringify({ databaseId: id, type: database.type, status: database.status, port: database.hostPort })); }
  } else if (phase === "database") {
    const type = process.argv[3] || "postgresql";
    const database = await call(state, "database.create", { name: `ops-smoke-${type}-${state.suffix}`, projectId: state.projectId, type, databaseName: "smoke", username: "smoke", password: state.password }, true);
    state.databases.push(database.id); save(state);
    const connection = await call(state, "database.getConnectionInfo", { id: database.id, target: "external" });
    console.log(JSON.stringify({ phase, id: database.id, type, host: connection.host, port: connection.port, status: database.status }));
  } else if (phase === "workflow") {
    const template = await call(state, "workflow.createTemplate", { name: `ops-smoke-${state.suffix}`, organizationId: state.orgId, definition: { triggers: [{type: "manual", config:{}}], steps: [{id:"deploy",name:"Deploy stack",type:"action",config:{action:"stack.deploy",resourceId:state.stacks[0]}},{id:"backup",name:"Back up database",type:"action",config:{action:"database.backup",resourceId:state.databases[0]}}] } }, true);
    state.workflows.push(template.id); save(state);
    await call(state,"workflow.updateTemplate",{id:template.id,status:"active"},true);
    const execution = await call(state,"workflow.executeWorkflow",{templateId:template.id},true);
    state.executionId=execution.id; save(state); console.log(JSON.stringify({phase,executionId:execution.id}));
  } else if (phase === "workflow-status") {
    const run = await call(state,"workflow.getExecutionById",{id:state.executionId}); console.log(JSON.stringify({status:run.status,currentStep:run.currentStep,error:run.errorMessage,results:Object.fromEntries(Object.entries(run.context).filter(([key])=>key!=="__definition"))}));
  } else if (phase === "cleanup") {
    for (const id of state.stacks) await call(state,"service.delete",{id,removeVolumes:true},true);
    for (const id of state.databases) await call(state,"database.delete",{id,destroyData:true},true);
    await db.delete(organizations).where(eq(organizations.id,state.orgId));
    await db.delete(users).where(eq(users.id,state.userId));
    fs.unlinkSync(statePath); console.log(JSON.stringify({phase,removed:true}));
  } else throw new Error("Unknown smoke phase");
}
main().then(()=>process.exit(0)).catch(error=>{ console.error(error.message);process.exit(1) });
