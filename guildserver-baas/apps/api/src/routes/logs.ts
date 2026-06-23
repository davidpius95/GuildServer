// Express route for log streaming — NOT tRPC because it streams chunked text
import { Router, Request, Response } from "express";
import { NodeSSH } from "node-ssh";
import { jwtVerify } from "jose";
import { db, baasProjects, baasNodes } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";

export const logsRouter: Router = Router();

const VALID_SERVICES = new Set(["kong", "auth", "rest", "realtime", "storage", "db", "functions", "meta"]);

logsRouter.get("/api/logs", async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    await jwtVerify(auth.slice(7), secret);
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { projectSlug, service = "kong", since, tail = "200" } = req.query as Record<string, string>;
  if (!projectSlug) return res.status(400).json({ error: "projectSlug required" });
  if (!VALID_SERVICES.has(service)) return res.status(400).json({ error: "Invalid service" });

  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.slug, projectSlug));
  if (!project?.nodeId) return res.status(404).json({ error: "Project not found" });

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) return res.status(404).json({ error: "Node not found" });

  const containerName = `baas-${projectSlug}-${service}`;
  const sinceFlag     = since ? `--since ${since}` : "";
  const tailFlag      = `--tail ${parseInt(tail, 10) || 200}`;
  const cmd           = `docker logs ${containerName} ${sinceFlag} ${tailFlag} --timestamps 2>&1`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: node.internalIp as string,
      port: node.sshPort ?? 22,
      username: node.sshUser ?? "root",
      ...(node.sshPrivateKey
        ? { privateKey: node.sshPrivateKey }
        : { agent: process.env.SSH_AUTH_SOCK }),
    });

    const result = await ssh.execCommand(cmd);
    res.send(result.stdout + result.stderr);
  } catch (err) {
    res.status(500).send(String(err));
  } finally {
    ssh.dispose();
  }
});

// SSE endpoint for live log streaming
logsRouter.get("/api/logs/stream", async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).end();

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    await jwtVerify(auth.slice(7), secret);
  } catch {
    return res.status(401).end();
  }

  const { projectSlug, service = "kong" } = req.query as Record<string, string>;
  if (!projectSlug || !VALID_SERVICES.has(service)) return res.status(400).end();

  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.slug, projectSlug));
  if (!project?.nodeId) return res.status(404).end();

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: node.internalIp as string,
      port: node.sshPort ?? 22,
      username: node.sshUser ?? "root",
      ...(node.sshPrivateKey
        ? { privateKey: node.sshPrivateKey }
        : { agent: process.env.SSH_AUTH_SOCK }),
    });

    const containerName = `baas-${projectSlug}-${service}`;
    ssh.connection!.exec(`docker logs -f --timestamps ${containerName} 2>&1`, (err: any, stream: any) => {
      if (err) { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); return; }

      stream.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          res.write(`data: ${JSON.stringify({ message: line, timestamp: new Date().toISOString() })}\n\n`);
        }
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          res.write(`data: ${JSON.stringify({ message: line, level: "error", timestamp: new Date().toISOString() })}\n\n`);
        }
      });

      stream.on("close", () => { res.end(); ssh.dispose(); });

      req.on("close", () => { stream.destroy(); ssh.dispose(); });
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
    ssh.dispose();
  }
});
