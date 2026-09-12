import { randomBytes, randomUUID } from "crypto";
import { PassThrough } from "stream";
import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db, applications, databases, services, projects, members, auditLogs } from "@guildserver/database";
import { and, eq } from "drizzle-orm";
import { docker, GS_LABELS } from "./docker/client";
import { logger } from "../utils/logger";

export const terminalTargetSchema = z.object({
  kind: z.enum(["application", "stack", "database"]),
  id: z.string().uuid(),
  service: z.string().min(1).max(255).optional(),
  shell: z.enum(["/bin/sh", "/bin/bash"]).default("/bin/sh"),
});
export type TerminalTarget = z.infer<typeof terminalTargetSchema>;

/** Resolve a resource through its organization, never a caller-supplied Docker ID. */
export async function authorizeTerminal(userId: string, target: TerminalTarget) {
  const resource = target.kind === "application"
    ? await db.query.applications.findFirst({ where: eq(applications.id, target.id) })
    : target.kind === "database"
      ? await db.query.databases.findFirst({ where: eq(databases.id, target.id) })
      : await db.query.services.findFirst({ where: eq(services.id, target.id) });
  const project = resource?.projectId && await db.query.projects.findFirst({ where: eq(projects.id, resource.projectId) });
  const member = project && await db.query.members.findFirst({ where: and(eq(members.organizationId, project.organizationId), eq(members.userId, userId)) });
  if (!resource || !project || !member || !["owner", "admin"].includes(member.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Container terminals require an owner or administrator of this resource's organization." });
  }
  // Fail closed rather than accidentally opening a similarly-labelled local workload.
  if ("providerId" in resource && resource.providerId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Browser terminals are currently available for local Docker workloads. Use your remote host's SSH access for this resource." });
  }
  if (target.kind === "stack" && !target.service) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a stack service." });
  return { organizationId: project.organizationId, name: resource.name };
}

export function assertTerminalContainer(info: import("dockerode").ContainerInspectInfo, target: TerminalTarget) {
  const labels = info.Config.Labels || {};
  const owned = target.kind === "stack"
    ? labels[GS_LABELS.SERVICE_ID] === target.id && labels[GS_LABELS.COMPOSE_SERVICE] === target.service
    : labels[GS_LABELS.APP_ID] === target.id;
  if (!owned || labels[GS_LABELS.MANAGED] !== "true" || !info.State.Running) throw new Error("The selected container is not running or no longer belongs to this resource.");
  if (info.HostConfig.Privileged || info.HostConfig.PidMode === "host" || info.HostConfig.NetworkMode === "host" ||
      (info.HostConfig.CapAdd || []).length || (info.Mounts || []).some(m => m.Type === "bind")) {
    throw new Error("Terminal unavailable: this container has host-level privileges or bind mounts. Use operator-managed access.");
  }
}

const tickets = new Map<string, { userId: string; target: TerminalTarget; expires: number }>();
export async function issueTerminalTicket(userId: string, target: TerminalTarget) {
  await authorizeTerminal(userId, target);
  for (const [key, value] of tickets) if (value.expires < Date.now()) tickets.delete(key);
  if (tickets.size >= 1000) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please retry shortly." });
  const ticket = randomBytes(32).toString("hex");
  tickets.set(ticket, { userId, target, expires: Date.now() + 30_000 });
  return { ticket, expiresIn: 30 };
}
export function consumeTerminalTicket(ticket: string) {
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  return entry && entry.expires > Date.now() ? entry : null;
}
const sessions = new Map<string, number>();

/** Short-lived, one-use ticket; no login token or shell input appears in the URL or audit log. */
export async function connectTerminal(ws: WebSocket, request: IncomingMessage, ticket: string) {
  const entry = consumeTerminalTicket(ticket);
  if (!entry) { ws.close(1008, "Terminal ticket expired. Reconnect."); return; }
  const { userId, target } = entry;
  if ((sessions.get(userId) || 0) >= 3) { ws.close(1008, "Close another terminal first (maximum 3)."); return; }
  const origin = request.headers.origin;
  const expected = process.env.FRONTEND_URL || process.env.NEXTAUTH_URL || `https://${process.env.BASE_DOMAIN || "guild-technologies.com"}`;
  if (!origin || new URL(origin).origin !== new URL(expected).origin) { ws.close(1008, "Invalid terminal origin."); return; }
  sessions.set(userId, (sessions.get(userId) || 0) + 1);
  const sessionId = randomUUID();
  let stream: NodeJS.ReadWriteStream | undefined;
  let ended = false;
  let idle = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ttl: ReturnType<typeof setTimeout> | undefined;
  let organizationId: string | undefined;
  const send = (message: object) => { if (ws.readyState === 1) ws.send(JSON.stringify(message)); };
  const close = () => {
    if (ended) return;
    ended = true;
    clearInterval(timer); clearTimeout(ttl);
    // EOF/disconnection closes the interactive shell; never kills the application container.
    if (stream) { stream.end(); (stream as PassThrough).destroy(); }
    sessions.set(userId, Math.max(0, (sessions.get(userId) || 1) - 1));
    if (organizationId) void db.insert(auditLogs).values({ userId, organizationId, action: "terminal.closed", resourceType: target.kind, resourceId: target.id, sessionId }).catch(() => {});
  };
  ws.once("close", close); ws.once("error", close);
  try {
    const access = await authorizeTerminal(userId, target);
    organizationId = access.organizationId;
    const labels = target.kind === "stack"
      ? [`${GS_LABELS.SERVICE_ID}=${target.id}`, `${GS_LABELS.COMPOSE_SERVICE}=${target.service}`]
      : [`${GS_LABELS.APP_ID}=${target.id}`];
    const containers = await docker.listContainers({ filters: { label: labels } });
    if (containers.length !== 1) throw new Error("Choose a resource with exactly one running container, then reconnect after deployment finishes.");
    const container = docker.getContainer(containers[0].Id);
    const info = await container.inspect();
    assertTerminalContainer(info, target);
    await db.insert(auditLogs).values({ userId, organizationId, action: "terminal.opened", resourceType: target.kind, resourceId: target.id, resourceName: access.name, sessionId, metadata: { service: target.service, shell: target.shell, containerId: info.Id } });
    if (ended) return;
    const exec = await container.exec({ Cmd: [target.shell], AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, Env: ["TERM=xterm-256color"], User: info.Config.User || "0", Privileged: false });
    stream = await exec.start({ hijack: true, stdin: true });
    if (ended) { stream.end(); (stream as PassThrough).destroy(); return; }
    send({ type: "ready" });
    stream.on("data", (data: Buffer) => {
      if (ws.bufferedAmount > 1024 * 1024) { ws.close(1009, "Terminal output exceeded buffer. Reconnect."); close(); return; }
      send({ type: "output", data: data.toString("base64") });
    });
    stream.on("end", () => { ws.close(1000, "Shell exited."); close(); });
    stream.on("error", () => { ws.close(1011, "Terminal disconnected."); close(); });
    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        idle = Date.now();
        if (message.type === "input" && typeof message.data === "string" && message.data.length <= 8192) stream?.write(message.data);
        else if (message.type === "resize" && Number.isInteger(message.cols) && Number.isInteger(message.rows) && message.cols >= 10 && message.cols <= 500 && message.rows >= 2 && message.rows <= 200) void exec.resize({ w: message.cols, h: message.rows }).catch(() => {});
        else if (message.type === "disconnect") { ws.close(1000, "Disconnected."); close(); }
        else { ws.close(1008, "Invalid terminal message."); close(); }
      } catch { ws.close(1008, "Invalid terminal message."); close(); }
    });
    timer = setInterval(() => {
      if (Date.now() - idle > 5 * 60_000) { ws.close(1000, "Terminal idle timeout."); close(); return; }
      void authorizeTerminal(userId, target).catch(() => { ws.close(1008, "Terminal access revoked."); close(); });
    }, 30_000);
    ttl = setTimeout(() => { ws.close(1000, "Session expired. Reconnect."); close(); }, 30 * 60_000);
  } catch (error) {
    logger.warn("Terminal connection refused", { userId, resourceId: target.id, error: String(error) });
    send({ type: "error", message: error instanceof TRPCError ? error.message : "Unable to open this shell. Check that the container is running, has the selected shell, and has no host-level privileges or bind mounts." });
    ws.close(1008, "Terminal unavailable."); close();
  }
}
