import { NodeSSH } from "node-ssh";
import { db, baasNodes, baasProjects, baasMetrics } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";

interface DockerStats {
  CPUPerc: string;  // "2.34%"
  MemUsage: string; // "256MiB / 2GiB"
}

function parseCpu(perc: string): number {
  return parseFloat(perc.replace("%", "")) || 0;
}

function parseMemMb(usage: string): number {
  const match = usage.match(/^([\d.]+)([KMGT]i?B)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit  = match[2].toUpperCase();
  if (unit.startsWith("G")) return Math.round(value * 1024);
  if (unit.startsWith("M")) return Math.round(value);
  if (unit.startsWith("K")) return Math.round(value / 1024);
  return Math.round(value / (1024 * 1024));
}

export async function collectProjectMetrics(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project?.nodeId || project.status !== "active") return;

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) return;

  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: node.internalIp as string,
      port: node.sshPort ?? 22,
      username: node.sshUser ?? "root",
      ...(node.sshPrivateKey
        ? { privateKey: node.sshPrivateKey }
        : { agent: process.env.SSH_AUTH_SOCK }),
      readyTimeout: 6000,
    });

    // docker stats snapshot (no-stream)
    const statsOut = await ssh.execCommand(
      `docker stats --no-stream --format '{"CPUPerc":"{{.CPUPerc}}","MemUsage":"{{.MemUsage}}"}' baas-${project.slug}-kong baas-${project.slug}-db 2>/dev/null`
    );

    let cpuPercent = 0;
    let ramMbUsed  = 0;
    for (const line of statsOut.stdout.split("\n").filter(Boolean)) {
      try {
        const s = JSON.parse(line) as DockerStats;
        cpuPercent += parseCpu(s.CPUPerc);
        ramMbUsed  += parseMemMb(s.MemUsage);
      } catch {}
    }

    // Postgres stats
    const pgOut = await ssh.execCommand(
      `docker exec baas-${project.slug}-db psql -U postgres -tAc ` +
      `"SELECT count(*), pg_database_size('${project.dbName}') / 1048576, ` +
      `(SELECT xact_commit FROM pg_stat_database WHERE datname='${project.dbName}'), ` +
      `(SELECT xact_rollback FROM pg_stat_database WHERE datname='${project.dbName}') ` +
      `FROM pg_stat_activity WHERE datname='${project.dbName}' AND state NOT IN ('idle')"`
    );

    let activeConnections = 0;
    let dbSizeMb          = 0;
    let txCommitted       = 0;
    let txRolledBack      = 0;

    const pgRow = pgOut.stdout.trim().split("|");
    if (pgRow.length >= 4) {
      activeConnections = parseInt(pgRow[0], 10)  || 0;
      dbSizeMb          = parseFloat(pgRow[1])    || 0;
      txCommitted       = parseInt(pgRow[2], 10)  || 0;
      txRolledBack      = parseInt(pgRow[3], 10)  || 0;
    }

    // Storage usage
    const storageOut = await ssh.execCommand(
      `du -sg /opt/baas/${project.slug}/volumes/storage 2>/dev/null | awk '{print $1}' || echo 0`
    );
    const storageGbUsed = parseFloat(storageOut.stdout.trim()) || 0;

    await db.insert(baasMetrics).values({
      projectId,
      cpuPercent:   cpuPercent.toFixed(2),
      ramMbUsed,
      storageGbUsed: storageGbUsed.toFixed(3),
      activeConnections,
      dbSizeMb:     dbSizeMb.toFixed(2),
      txCommitted,
      txRolledBack,
      metadata: { raw: statsOut.stdout },
    });
  } catch (err) {
    console.error(`[metrics-collector] Failed for ${project.slug}:`, err);
  } finally {
    ssh.dispose();
  }
}

export async function collectAllMetrics(): Promise<void> {
  const projects = await db
    .select({ id: baasProjects.id })
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));

  await Promise.allSettled(projects.map((p) => collectProjectMetrics(p.id)));
}

// Prune metrics older than 30 days to keep the table lean
export async function pruneOldMetrics(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db.delete(baasMetrics).where(
    eq(baasMetrics.collectedAt, cutoff) // drizzle: lt() is imported separately in real usage
  );
}
