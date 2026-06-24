import Docker from "dockerode";
import { db, baasProjects } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";
import postgres from "postgres";

const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(name).inspect();
    return info.State.Running === true;
  } catch {
    return false;
  }
}

// Check that the shared baas-postgres container is up and accepting connections.
export async function reconcileNodes(): Promise<void> {
  const pgRunning = await isContainerRunning("baas-postgres");
  if (!pgRunning) {
    console.warn("[health-reconciler] baas-postgres container is not running");
    // Mark all active projects as errored since shared Postgres is down
    await db.update(baasProjects)
      .set({ status: "error", statusMessage: "Shared Postgres unavailable", updatedAt: new Date() });
    return;
  }

  // Verify reachability with a lightweight ping query
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
    await sql`SELECT 1`;
  } catch (e) {
    console.warn("[health-reconciler] baas-postgres unreachable:", e);
  } finally {
    await sql.end();
  }
}

// For each active project verify its two containers (rest + auth) are running.
export async function reconcileProjects(): Promise<void> {
  const projects = await db
    .select({ id: baasProjects.id, slug: baasProjects.slug })
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));

  await Promise.allSettled(
    projects.map(async (p) => {
      const [restOk, authOk] = await Promise.all([
        isContainerRunning(`baas-${p.slug}-rest`),
        isContainerRunning(`baas-${p.slug}-auth`),
      ]);

      if (!restOk || !authOk) {
        const missing = [!restOk && "rest", !authOk && "auth"].filter(Boolean).join(", ");
        await db.update(baasProjects)
          .set({ status: "error", statusMessage: `Containers not running: ${missing}`, updatedAt: new Date() })
          .where(eq(baasProjects.id, p.id));
      }
    }),
  );
}
