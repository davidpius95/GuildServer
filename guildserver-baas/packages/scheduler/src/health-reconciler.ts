import { NodeSSH } from "node-ssh";
import { db, baasNodes, baasProjects } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";

async function tryConnect(node: typeof baasNodes.$inferSelect): Promise<NodeSSH | null> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: node.internalIp as string,
      port: node.sshPort ?? 22,
      username: node.sshUser ?? "root",
      ...(node.sshPrivateKey
        ? { privateKey: node.sshPrivateKey }
        : { agent: process.env.SSH_AUTH_SOCK }),
      readyTimeout: 8000,
    });
    return ssh;
  } catch {
    return null;
  }
}

export async function reconcileNodes(): Promise<void> {
  const nodes = await db.select().from(baasNodes);

  for (const node of nodes) {
    const ssh = await tryConnect(node);
    if (!ssh) {
      await db.update(baasNodes)
        .set({ status: "offline", updatedAt: new Date() })
        .where(eq(baasNodes.id, node.id));

      // Mark all active projects on this node as errored
      await db.update(baasProjects)
        .set({ status: "error", statusMessage: "Compute node unreachable", updatedAt: new Date() })
        .where(eq(baasProjects.nodeId, node.id));
      continue;
    }

    try {
      const [ramOut, cpuOut, storageOut] = await Promise.all([
        ssh.execCommand("free -m | awk 'NR==2{print $3}'"),
        ssh.execCommand("nproc"),
        ssh.execCommand("df -BG /opt/baas 2>/dev/null | awk 'NR==2{print $3}' | tr -d G || echo 0"),
      ]);

      const ramMbUsed    = parseInt(ramOut.stdout.trim(),     10) || 0;
      const vcpuUsed     = parseInt(cpuOut.stdout.trim(),     10) || 0;
      const storageGbUsed = parseInt(storageOut.stdout.trim(), 10) || 0;

      await db.update(baasNodes)
        .set({ status: "online", ramMbUsed, vcpuUsed, storageGbUsed, lastHeartbeat: new Date(), updatedAt: new Date() })
        .where(eq(baasNodes.id, node.id));
    } finally {
      ssh.dispose();
    }
  }
}

export async function reconcileProjects(): Promise<void> {
  const projects = await db
    .select()
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));

  for (const project of projects) {
    if (!project.nodeId) continue;
    const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
    if (!node) continue;

    const ssh = await tryConnect(node);
    if (!ssh) continue;

    try {
      const result = await ssh.execCommand(
        `docker inspect --format='{{.State.Running}}' baas-${project.slug}-kong 2>/dev/null || echo false`
      );
      const running = result.stdout.trim() === "true";
      if (!running) {
        await db.update(baasProjects)
          .set({ status: "error", statusMessage: "Kong container not running", updatedAt: new Date() })
          .where(eq(baasProjects.id, project.id));
      }
    } finally {
      ssh.dispose();
    }
  }
}
