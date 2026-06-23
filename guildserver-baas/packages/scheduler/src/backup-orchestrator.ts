import { NodeSSH } from "node-ssh";
import { db, baasNodes, baasProjects, baasBackups } from "@guildserver/baas-db";
import { eq, and, lt } from "drizzle-orm";

async function sshConnect(node: typeof baasNodes.$inferSelect) {
  const { NodeSSH: SSH } = await import("node-ssh");
  const ssh = new SSH();
  await ssh.connect({
    host: node.internalIp as string,
    port: node.sshPort ?? 22,
    username: node.sshUser ?? "root",
    ...(node.sshPrivateKey
      ? { privateKey: node.sshPrivateKey }
      : { agent: process.env.SSH_AUTH_SOCK }),
  });
  return ssh;
}

export async function createBackup(
  projectId: string,
  backupType: "manual" | "automatic" = "automatic"
): Promise<string> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project?.nodeId) throw new Error("Project has no node assigned");

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) throw new Error("Node not found");

  const timestamp   = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath    = `/opt/baas/${project.slug}/backups/${timestamp}.sql.gz`;
  const retentionMs = (project.backupRetentionDays ?? 7) * 24 * 60 * 60 * 1000;
  const expiresAt   = new Date(Date.now() + retentionMs);

  const [record] = await db.insert(baasBackups).values({
    projectId,
    backupType,
    status: "in_progress",
    filePath,
    expiresAt,
  }).returning({ id: baasBackups.id });

  const ssh = await sshConnect(node);
  try {
    await ssh.execCommand(`mkdir -p /opt/baas/${project.slug}/backups`);

    const result = await ssh.execCommand(
      `docker exec baas-${project.slug}-db pg_dump -U ${project.dbUser} -d ${project.dbName} -F c | gzip > ${filePath}`
    );
    if (result.code !== 0) throw new Error(result.stderr);

    const stat = await ssh.execCommand(`stat -c%s ${filePath}`);
    const sizeBytes = parseInt(stat.stdout.trim(), 10) || 0;

    await db.update(baasBackups)
      .set({ status: "completed", completedAt: new Date(), sizeBytes })
      .where(eq(baasBackups.id, record.id));
  } catch (err) {
    await db.update(baasBackups)
      .set({ status: "failed", error: String(err) })
      .where(eq(baasBackups.id, record.id));
    throw err;
  } finally {
    ssh.dispose();
  }

  return record.id;
}

export async function restoreBackup(backupId: string): Promise<void> {
  const [backup] = await db.select().from(baasBackups).where(eq(baasBackups.id, backupId));
  if (!backup?.filePath) throw new Error("Backup not found or has no file");

  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, backup.projectId));
  if (!project?.nodeId) throw new Error("Project has no node");

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) throw new Error("Node not found");

  const ssh = await sshConnect(node);
  try {
    // Stop app services but keep DB running
    await ssh.execCommand(
      `docker compose stop kong auth rest realtime storage imgproxy meta functions studio supavisor`,
      { cwd: `/opt/baas/${project.slug}` }
    );

    // Drop & recreate DB
    const dbContainer = `baas-${project.slug}-db`;
    await ssh.execCommand(
      `docker exec ${dbContainer} psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${project.dbName}' AND pid <> pg_backend_pid()"`
    );
    await ssh.execCommand(`docker exec ${dbContainer} psql -U postgres -c "DROP DATABASE IF EXISTS \\"${project.dbName}\\""`);
    await ssh.execCommand(`docker exec ${dbContainer} psql -U postgres -c "CREATE DATABASE \\"${project.dbName}\\" OWNER \\"${project.dbUser}\\""`);

    // Restore
    const restore = await ssh.execCommand(
      `zcat ${backup.filePath} | docker exec -i ${dbContainer} pg_restore -U ${project.dbUser} -d ${project.dbName} --no-owner --no-privileges`
    );
    if (restore.code !== 0 && !restore.stderr.includes("already exists")) {
      throw new Error(restore.stderr);
    }

    // Restart app services
    await ssh.execCommand("docker compose up -d", { cwd: `/opt/baas/${project.slug}` });
  } finally {
    ssh.dispose();
  }
}

// PITR: restore DB to a specific point in time using WAL archives
export async function restoreToPointInTime(projectId: string, targetTime: Date): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project?.nodeId) throw new Error("Project has no node");
  if (!project.walArchiveEnabled || !project.walArchivePath) {
    throw new Error("WAL archiving is not enabled for this project");
  }

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) throw new Error("Node not found");

  const targetStr = targetTime.toISOString().replace("T", " ").replace("Z", "+00");

  const ssh = await sshConnect(node);
  try {
    const dir = `/opt/baas/${project.slug}`;

    // Stop all services
    await ssh.execCommand("docker compose down", { cwd: dir });

    // Write recovery.conf for PITR
    const recoveryConf = `restore_command = 'cp ${project.walArchivePath}/%f %p'\nrecovery_target_time = '${targetStr}'\nrecovery_target_action = 'promote'\n`;
    await ssh.execCommand(`echo '${recoveryConf}' > ${dir}/volumes/db/recovery.conf`);

    // Restart and let postgres replay WAL
    await ssh.execCommand("docker compose up -d db", { cwd: dir });
    // Wait for recovery to complete (poll pg_is_in_recovery())
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const check = await ssh.execCommand(
        `docker exec baas-${project.slug}-db psql -U postgres -tAc "SELECT pg_is_in_recovery()"`
      );
      if (check.stdout.trim() === "f") break;
    }

    // Bring everything back up
    await ssh.execCommand("docker compose up -d", { cwd: dir });
    await ssh.execCommand(`rm -f ${dir}/volumes/db/recovery.conf`);
  } finally {
    ssh.dispose();
  }
}

// Nightly sweep — remove expired backup files and DB records
export async function sweepExpiredBackups(): Promise<void> {
  const expired = await db
    .select()
    .from(baasBackups)
    .where(and(lt(baasBackups.expiresAt, new Date()), eq(baasBackups.status, "completed")));

  for (const backup of expired) {
    if (!backup.filePath) continue;
    const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, backup.projectId));
    if (project?.nodeId) {
      const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
      if (node) {
        const ssh = await sshConnect(node);
        try { await ssh.execCommand(`rm -f ${backup.filePath}`); }
        finally { ssh.dispose(); }
      }
    }
    await db.delete(baasBackups).where(eq(baasBackups.id, backup.id));
  }
}
