import Docker from "dockerode";
import postgres from "postgres";
import { db, baasProjects, baasMetrics } from "@guildserver/baas-db";
import { eq, lt } from "drizzle-orm";

const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

async function getContainerCpuAndMemMb(name: string): Promise<{ cpuPercent: number; memMb: number }> {
  try {
    const container = docker.getContainer(name);
    const stats = await container.stats({ stream: false }) as any;

    const cpuDelta    = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage      - stats.precpu_stats.system_cpu_usage;
    const numCpus     = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
    const cpuPercent  = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

    const memMb = (stats.memory_stats.usage ?? 0) / (1024 * 1024);

    return { cpuPercent, memMb };
  } catch {
    return { cpuPercent: 0, memMb: 0 };
  }
}

async function getTenantDbStats(
  dbName: string,
): Promise<{ activeConnections: number; dbSizeMb: number; txCommitted: number; txRolledBack: number }> {
  const sql = postgres({
    host:     process.env.BAAS_PG_HOST     ?? "baas-postgres",
    port:     parseInt(process.env.BAAS_PG_PORT ?? "5432"),
    username: process.env.BAAS_PG_ADMIN_USER     ?? "postgres",
    password: process.env.BAAS_PG_ADMIN_PASSWORD ?? "",
    database: "postgres",
    max: 1,
    connect_timeout: 5,
  });
  try {
    const [row] = await sql<[{
      active_connections: string;
      db_size_mb: string;
      tx_committed: string;
      tx_rolled_back: string;
    }]>`
      SELECT
        (SELECT count(*)::text FROM pg_stat_activity WHERE datname = ${dbName} AND state NOT IN ('idle')) AS active_connections,
        (pg_database_size(${dbName}) / 1048576.0)::text                                                  AS db_size_mb,
        COALESCE((SELECT xact_commit::text  FROM pg_stat_database WHERE datname = ${dbName}), '0')       AS tx_committed,
        COALESCE((SELECT xact_rollback::text FROM pg_stat_database WHERE datname = ${dbName}), '0')      AS tx_rolled_back
    `;
    return {
      activeConnections: parseInt(row?.active_connections ?? "0", 10),
      dbSizeMb:          parseFloat(row?.db_size_mb       ?? "0"),
      txCommitted:       parseInt(row?.tx_committed        ?? "0", 10),
      txRolledBack:      parseInt(row?.tx_rolled_back      ?? "0", 10),
    };
  } finally {
    await sql.end();
  }
}

export async function collectProjectMetrics(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project || project.status !== "active") return;

  try {
    const [restStats, authStats, dbStats] = await Promise.all([
      getContainerCpuAndMemMb(`baas-${project.slug}-rest`),
      getContainerCpuAndMemMb(`baas-${project.slug}-auth`),
      getTenantDbStats(project.dbName),
    ]);

    const cpuPercent = restStats.cpuPercent + authStats.cpuPercent;
    const ramMbUsed  = restStats.memMb      + authStats.memMb;

    await db.insert(baasMetrics).values({
      projectId,
      cpuPercent:       cpuPercent.toFixed(2),
      ramMbUsed:        Math.round(ramMbUsed),
      storageGbUsed:    "0",           // disk usage tracked separately if needed
      activeConnections: dbStats.activeConnections,
      dbSizeMb:         dbStats.dbSizeMb.toFixed(2),
      txCommitted:      dbStats.txCommitted,
      txRolledBack:     dbStats.txRolledBack,
      metadata:         {},
    });
  } catch (err) {
    console.error(`[metrics-collector] Failed for ${project.slug}:`, err);
  }
}

export async function collectAllMetrics(): Promise<void> {
  const projects = await db
    .select({ id: baasProjects.id })
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));

  await Promise.allSettled(projects.map((p) => collectProjectMetrics(p.id)));
}

export async function pruneOldMetrics(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db.delete(baasMetrics).where(lt(baasMetrics.collectedAt, cutoff));
}
