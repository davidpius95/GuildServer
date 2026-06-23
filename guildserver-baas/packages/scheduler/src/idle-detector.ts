import { NodeSSH } from "node-ssh";
import { db, baasNodes, baasProjects } from "@guildserver/baas-db";
import { eq, and, isNotNull, lt } from "drizzle-orm";
import { pauseProject } from "./project-lifecycle";

// Checks active DB connections inside each project's postgres container.
// If a project has had zero connections for longer than idleTimeoutMinutes, it is paused.
export async function detectIdleProjects(): Promise<void> {
  const active = await db
    .select()
    .from(baasProjects)
    .where(
      and(
        eq(baasProjects.status, "active"),
        isNotNull(baasProjects.idleTimeoutMinutes),
      )
    );

  const now = Date.now();

  for (const project of active) {
    if (!project.nodeId || !project.idleTimeoutMinutes) continue;

    const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
    if (!node) continue;

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

      // Count non-idle, non-superuser connections to the project DB
      const result = await ssh.execCommand(
        `docker exec baas-${project.slug}-db psql -U postgres -tAc ` +
        `"SELECT count(*) FROM pg_stat_activity WHERE datname='${project.dbName}' ` +
        `AND state NOT IN ('idle') AND pid <> pg_backend_pid()"`
      );

      const activeConns = parseInt(result.stdout.trim(), 10) || 0;

      if (activeConns > 0) {
        // Update lastActivityAt on any connection activity
        await db.update(baasProjects)
          .set({ lastActivityAt: new Date(), updatedAt: new Date() })
          .where(eq(baasProjects.id, project.id));
        continue;
      }

      // Check if idle for longer than the timeout
      const lastActivity = project.lastActivityAt?.getTime() ?? project.createdAt?.getTime() ?? now;
      const idleSinceMs  = now - lastActivity;
      const timeoutMs    = project.idleTimeoutMinutes * 60 * 1000;

      if (idleSinceMs >= timeoutMs) {
        console.log(`[idle-detector] Pausing idle project ${project.slug} (idle ${Math.round(idleSinceMs / 60000)}m)`);
        await pauseProject(project.id);
      }
    } catch (err) {
      console.error(`[idle-detector] Error checking project ${project.slug}:`, err);
    } finally {
      ssh.dispose();
    }
  }
}
