import { randomBytes, randomUUID } from "crypto";
import net from "net";
import { createWebSocketStream, type WebSocket } from "ws";
import { TRPCError } from "@trpc/server";
import { db, databases, projects, members, auditLogs } from "@guildserver/database";
import { and, eq } from "drizzle-orm";
import { docker, GS_LABELS, NETWORK_NAME } from "./docker/client";

export async function authorizeDatabaseTunnel(userId: string, id: string) {
  const database = await db.query.databases.findFirst({ where: eq(databases.id, id) });
  const project = database && await db.query.projects.findFirst({ where: eq(projects.id, database.projectId) });
  const member = project && await db.query.members.findFirst({ where: and(eq(members.organizationId, project.organizationId), eq(members.userId, userId)) });
  if (!database || !project || !member) throw new TRPCError({ code: "NOT_FOUND", message: "Database not found or access denied." });
  return { database, organizationId: project.organizationId };
}
const tickets = new Map<string, { userId: string; id: string; expires: number }>();
export async function issueDatabaseTunnelTicket(userId: string, id: string) {
  await authorizeDatabaseTunnel(userId, id);
  for (const [key, entry] of tickets) if (entry.expires < Date.now()) tickets.delete(key);
  if (tickets.size >= 1000) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please retry shortly." });
  const ticket = randomBytes(32).toString("hex"); tickets.set(ticket, { userId, id, expires: Date.now() + 30000 });
  return { ticket };
}
export function consumeDatabaseTunnelTicket(ticket: string) {
  const entry = tickets.get(ticket); tickets.delete(ticket);
  return entry && entry.expires > Date.now() ? entry : null;
}
const counts = new Map<string, number>();
export async function connectDatabaseTunnel(ws: WebSocket, ticket: string) {
  const entry = consumeDatabaseTunnelTicket(ticket);
  if (!entry) { ws.close(1008, "Tunnel ticket expired. Reconnect."); return; }
  const { userId, id } = entry;
  if ((counts.get(userId) || 0) >= 20) { ws.close(1008, "Too many database connections."); return; }
  counts.set(userId, (counts.get(userId) || 0) + 1);
  let socket: net.Socket | undefined;
  let stream: ReturnType<typeof createWebSocketStream> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ttl: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  const close = () => { if (ended) return; ended = true; socket?.destroy(); stream?.destroy(); clearInterval(timer); clearTimeout(ttl); counts.set(userId, Math.max(0, (counts.get(userId) || 1) - 1)); };
  ws.once("close", close); ws.once("error", close);
  try {
    const access = await authorizeDatabaseTunnel(userId, id);
    const port = ({ postgresql:5432, mysql:3306, mariadb:3306, mongodb:27017, redis:6379 } as Record<string,number>)[access.database.type];
    if (!port) throw new Error("Unsupported database engine.");
    const containers = await docker.listContainers({ filters: { label: [`${GS_LABELS.APP_ID}=${id}`, `${GS_LABELS.TYPE}=database`] } });
    if (containers.length !== 1) throw new Error("Database is not running.");
    const info = await docker.getContainer(containers[0].Id).inspect();
    if (info.Config.Labels?.[GS_LABELS.APP_ID] !== id || info.Config.Labels?.[GS_LABELS.TYPE] !== "database" || !info.State.Running) throw new Error("Database unavailable.");
    const host = info.NetworkSettings.Networks[NETWORK_NAME]?.IPAddress;
    if (!host) throw new Error("Database network unavailable.");
    await db.insert(auditLogs).values({ userId, organizationId:access.organizationId, action:"database.tunnel.opened", resourceType:"database",resourceId:id,sessionId:randomUUID() });
    if (ended) return;
    socket = net.createConnection({host,port}); socket.setTimeout(10_000);
    socket.once("connect",()=>socket?.setTimeout(5*60_000));
    socket.on("timeout",()=>{ws.close(1000,"Database connection timed out.");close()});
    socket.on("error",()=>{ws.close(1011,"Database connection unavailable.");close()});
    stream = createWebSocketStream(ws,{highWaterMark:64*1024});
    stream.on("error",close); socket.pipe(stream).pipe(socket);
    timer=setInterval(()=>{void authorizeDatabaseTunnel(userId,id).catch(()=>{ws.close(1008,"Database access revoked.");close()})},30000);
    ttl=setTimeout(()=>{ws.close(1000,"Tunnel connection expired. Reconnect.");close()},60*60_000);
  } catch { ws.close(1008,"Database not available or access denied.");close(); }
}
