import postgres from "postgres";
import { db, baasProjects } from "@guildserver/baas-db";
import { eq, and, isNotNull } from "drizzle-orm";
import { pauseProject } from "./project-lifecycle";

// Query the shared baas-postgres for active connections to a tenant database.
async function getActiveConnectionCount(dbName: string): Promise<number> {
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
    const rows = await sql<[{ count: string }]>`
      SELECT count(*)::text AS count
        FROM pg_stat_activity
       WHERE datname = ${dbName}
         AND state NOT IN ('idle')
         AND pid <> pg_backend_pid()
    `;
    return parseInt(rows[0]?.count ?? "0", 10);
  } finally {
    await sql.end();
  }
}

export async function detectIdleProjects(): Promise<void> {
  const active = await db
    .select()
    .from(baasProjects)
    .where(
      and(
        eq(baasProjects.status, "active"),
        isNotNull(baasProjects.idleTimeoutMinutes),
      ),
    );

  const now = Date.now();

  await Promise.allSettled(
    active.map(async (project) => {
      if (!project.idleTimeoutMinutes) return;

      try {
        const activeConns = await getActiveConnectionCount(project.dbName);

        if (activeConns > 0) {
          await db.update(baasProjects)
            .set({ lastActivityAt: new Date(), updatedAt: new Date() })
            .where(eq(baasProjects.id, project.id));
          return;
        }

        const lastActivity = project.lastActivityAt?.getTime() ?? project.createdAt?.getTime() ?? now;
        const idleSinceMs  = now - lastActivity;
        const timeoutMs    = project.idleTimeoutMinutes * 60 * 1000;

        if (idleSinceMs >= timeoutMs) {
          console.log(`[idle-detector] Pausing idle project ${project.slug} (idle ${Math.round(idleSinceMs / 60000)}m)`);
          await pauseProject(project.id);
        }
      } catch (err) {
        console.error(`[idle-detector] Error checking project ${project.slug}:`, err);
      }
    }),
  );
}
