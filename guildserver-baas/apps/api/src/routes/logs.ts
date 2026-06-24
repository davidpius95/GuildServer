// Express route for log streaming — NOT tRPC because it streams chunked text
import { Router, Request, Response } from "express";
import Docker from "dockerode";
import { jwtVerify } from "jose";
import { db, baasProjects } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";

export const logsRouter: Router = Router();

const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

// Only rest and auth are per-tenant containers in the shared-platform model
const VALID_SERVICES = new Set(["rest", "auth"]);

async function verifyBearer(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    await jwtVerify(authHeader.slice(7), secret);
    return true;
  } catch {
    return false;
  }
}

logsRouter.get("/api/logs", async (req: Request, res: Response) => {
  if (!await verifyBearer(req.headers.authorization)) return res.status(401).json({ error: "Unauthorized" });

  const { projectSlug, service = "rest", since, tail = "200" } = req.query as Record<string, string>;
  if (!projectSlug) return res.status(400).json({ error: "projectSlug required" });
  if (!VALID_SERVICES.has(service)) return res.status(400).json({ error: "Invalid service" });

  const [project] = await db.select({ slug: baasProjects.slug }).from(baasProjects).where(eq(baasProjects.slug, projectSlug));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const containerName = `baas-${projectSlug}-${service}`;

  try {
    const container = docker.getContainer(containerName);
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: parseInt(tail, 10) || 200,
      since: since ? parseInt(since, 10) : undefined,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Docker multiplexes stdout/stderr with an 8-byte header — strip it
    let output = "";
    const buf = Buffer.isBuffer(logStream) ? logStream : Buffer.from(logStream as any);
    let offset = 0;
    while (offset < buf.length) {
      if (offset + 8 > buf.length) break;
      const size = buf.readUInt32BE(offset + 4);
      offset += 8;
      output += buf.subarray(offset, offset + size).toString("utf8");
      offset += size;
    }
    res.send(output);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

// SSE endpoint for live log streaming
logsRouter.get("/api/logs/stream", async (req: Request, res: Response) => {
  if (!await verifyBearer(req.headers.authorization)) return res.status(401).end();

  const { projectSlug, service = "rest" } = req.query as Record<string, string>;
  if (!projectSlug || !VALID_SERVICES.has(service)) return res.status(400).end();

  const [project] = await db.select({ slug: baasProjects.slug }).from(baasProjects).where(eq(baasProjects.slug, projectSlug));
  if (!project) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const containerName = `baas-${projectSlug}-${service}`;

  try {
    const container = docker.getContainer(containerName);
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      follow: true,
    }) as NodeJS.ReadableStream;

    logStream.on("data", (chunk: Buffer) => {
      // Strip Docker multiplexing header (8 bytes)
      let offset = 0;
      while (offset < chunk.length) {
        if (offset + 8 > chunk.length) break;
        const size = chunk.readUInt32BE(offset + 4);
        offset += 8;
        const text = chunk.subarray(offset, offset + size).toString("utf8");
        for (const line of text.split("\n").filter(Boolean)) {
          res.write(`data: ${JSON.stringify({ message: line, timestamp: new Date().toISOString() })}\n\n`);
        }
        offset += size;
      }
    });

    logStream.on("end", () => res.end());

    req.on("close", () => {
      try { (logStream as any).destroy?.(); } catch {}
      res.end();
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
});
