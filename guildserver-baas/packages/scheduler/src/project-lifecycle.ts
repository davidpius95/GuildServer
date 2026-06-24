import Docker from "dockerode";
import { db, baasProjects } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";
import { generateProjectSecrets } from "./secrets";
import { createTenantDatabase, dropTenantDatabase } from "./tenant-db";

// ── Docker client (uses local socket — scheduler must run on the Docker host) ──
const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

const BAAS_NETWORK   = process.env.BAAS_DOCKER_NETWORK  ?? "guildserver";
const BAAS_PG_HOST   = process.env.BAAS_PG_HOST         ?? "baas-postgres";
const BAAS_PG_PORT   = parseInt(process.env.BAAS_PG_PORT ?? "5432");
const BASE_DOMAIN    = process.env.BAAS_FALLBACK_DOMAIN  ?? "baas.guildserver.com";
const USE_TLS        = process.env.BAAS_TLS              !== "false";
const CERT_RESOLVER  = process.env.BAAS_CERT_RESOLVER    ?? "letsencrypt";

const IMAGES = {
  rest:  "postgrest/postgrest:v14.12",
  auth:  "supabase/gotrue:v2.189.0",
};

export interface ProvisionInput {
  projectId:      string;
  slug:           string;
  organizationId: string;
  dbName:         string;
  dbUser:         string;
  ramMbLimit?:    number;
  vcpuLimit?:     number;
  storageGbLimit?: number;
  siteUrl?:       string;
}

// ── Traefik label builders ─────────────────────────────────────────────────────

function restLabels(slug: string): Record<string, string> {
  const svc    = `baas-rest-${slug}`;
  const mw     = `${svc}-strip`;
  const domain = `${slug}.${BASE_DOMAIN}`;
  const rule   = `Host(\`${domain}\`) && PathPrefix(\`/rest/v1\`)`;

  const labels: Record<string, string> = {
    "traefik.enable": "true",
    [`traefik.docker.network`]: BAAS_NETWORK,
    [`traefik.http.services.${svc}.loadbalancer.server.port`]: "3000",
    [`traefik.http.middlewares.${mw}.stripprefix.prefixes`]:   "/rest/v1",
    // HTTP router
    [`traefik.http.routers.${svc}.rule`]:        rule,
    [`traefik.http.routers.${svc}.entrypoints`]: "web",
    [`traefik.http.routers.${svc}.service`]:     svc,
    [`traefik.http.routers.${svc}.middlewares`]: mw,
  };

  if (USE_TLS) {
    labels[`traefik.http.routers.${svc}-tls.rule`]               = rule;
    labels[`traefik.http.routers.${svc}-tls.entrypoints`]        = "websecure";
    labels[`traefik.http.routers.${svc}-tls.service`]            = svc;
    labels[`traefik.http.routers.${svc}-tls.tls`]                = "true";
    labels[`traefik.http.routers.${svc}-tls.tls.certresolver`]   = CERT_RESOLVER;
    labels[`traefik.http.routers.${svc}-tls.middlewares`]        = mw;
  }

  return labels;
}

function authLabels(slug: string): Record<string, string> {
  const svc    = `baas-auth-${slug}`;
  const mw     = `${svc}-strip`;
  const domain = `${slug}.${BASE_DOMAIN}`;
  const rule   = `Host(\`${domain}\`) && PathPrefix(\`/auth/v1\`)`;

  const labels: Record<string, string> = {
    "traefik.enable": "true",
    [`traefik.docker.network`]: BAAS_NETWORK,
    [`traefik.http.services.${svc}.loadbalancer.server.port`]: "9999",
    [`traefik.http.middlewares.${mw}.stripprefix.prefixes`]:   "/auth/v1",
    // HTTP router
    [`traefik.http.routers.${svc}.rule`]:        rule,
    [`traefik.http.routers.${svc}.entrypoints`]: "web",
    [`traefik.http.routers.${svc}.service`]:     svc,
    [`traefik.http.routers.${svc}.middlewares`]: mw,
  };

  if (USE_TLS) {
    labels[`traefik.http.routers.${svc}-tls.rule`]              = rule;
    labels[`traefik.http.routers.${svc}-tls.entrypoints`]       = "websecure";
    labels[`traefik.http.routers.${svc}-tls.service`]           = svc;
    labels[`traefik.http.routers.${svc}-tls.tls`]               = "true";
    labels[`traefik.http.routers.${svc}-tls.tls.certresolver`]  = CERT_RESOLVER;
    labels[`traefik.http.routers.${svc}-tls.middlewares`]       = mw;
  }

  return labels;
}

// ── Container config builders ─────────────────────────────────────────────────

function restContainerConfig(
  slug:           string,
  dbName:         string,
  dbUser:         string,
  dbPassword:     string,
  jwtSecret:      string,
  vcpuLimit:      number,
  ramMbLimit:     number,
): Docker.ContainerCreateOptions {
  return {
    Image: IMAGES.rest,
    Env: [
      `PGRST_DB_URI=postgres://${dbUser}:${dbPassword}@${BAAS_PG_HOST}:${BAAS_PG_PORT}/${dbName}`,
      `PGRST_DB_SCHEMAS=public,storage,graphql_public`,
      `PGRST_DB_ANON_ROLE=anon`,
      `PGRST_JWT_SECRET=${jwtSecret}`,
      `PGRST_DB_USE_LEGACY_GUCS=false`,
      `PGRST_APP_SETTINGS_JWT_SECRET=${jwtSecret}`,
      `PGRST_APP_SETTINGS_JWT_EXP=3600`,
      `PGRST_SERVER_CORS_ALLOWED_ORIGINS=*`,
    ],
    Labels: restLabels(slug),
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode:   BAAS_NETWORK,
      NanoCpus:      Math.round(vcpuLimit  * 0.25 * 1e9),
      Memory:        Math.round(ramMbLimit * 0.15 * 1024 * 1024),
    },
  };
}

function authContainerConfig(
  slug:           string,
  dbName:         string,
  dbPassword:     string,
  jwtSecret:      string,
  apiUrl:         string,
  siteUrl:        string,
  vcpuLimit:      number,
  ramMbLimit:     number,
): Docker.ContainerCreateOptions {
  const smtpHost = process.env.SMTP_HOST ?? "";
  const smtpPort = process.env.SMTP_PORT ?? "587";
  const smtpUser = process.env.SMTP_USER ?? "";
  const smtpPass = process.env.SMTP_PASS ?? "";

  return {
    Image: IMAGES.auth,
    Env: [
      `GOTRUE_API_HOST=0.0.0.0`,
      `GOTRUE_API_PORT=9999`,
      `API_EXTERNAL_URL=${apiUrl}`,
      `GOTRUE_DB_DRIVER=postgres`,
      `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${dbPassword}@${BAAS_PG_HOST}:${BAAS_PG_PORT}/${dbName}`,
      `GOTRUE_SITE_URL=${siteUrl}`,
      `GOTRUE_JWT_ADMIN_ROLES=service_role`,
      `GOTRUE_JWT_AUD=authenticated`,
      `GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated`,
      `GOTRUE_JWT_EXP=3600`,
      `GOTRUE_JWT_SECRET=${jwtSecret}`,
      `GOTRUE_MAILER_AUTOCONFIRM=true`,
      `GOTRUE_SMTP_HOST=${smtpHost}`,
      `GOTRUE_SMTP_PORT=${smtpPort}`,
      `GOTRUE_SMTP_USER=${smtpUser}`,
      `GOTRUE_SMTP_PASS=${smtpPass}`,
    ],
    Labels: authLabels(slug),
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode:   BAAS_NETWORK,
      NanoCpus:      Math.round(vcpuLimit  * 0.25 * 1e9),
      Memory:        Math.round(ramMbLimit * 0.20 * 1024 * 1024),
    },
  };
}

// ── Docker helpers ─────────────────────────────────────────────────────────────

async function runContainer(name: string, config: Docker.ContainerCreateOptions): Promise<void> {
  // Remove any leftover container with the same name
  try {
    const old = docker.getContainer(name);
    await old.stop({ t: 5 }).catch(() => {});
    await old.remove();
  } catch {}

  const container = await docker.createContainer({ ...config, name });
  await container.start();
}

async function stopContainer(name: string): Promise<void> {
  try {
    await docker.getContainer(name).stop({ t: 5 });
  } catch {}
}

async function startContainer(name: string): Promise<void> {
  try {
    await docker.getContainer(name).start();
  } catch {}
}

async function removeContainer(name: string): Promise<void> {
  try {
    const c = docker.getContainer(name);
    await c.stop({ t: 5 }).catch(() => {});
    await c.remove();
  } catch {}
}

// ── Public lifecycle functions ─────────────────────────────────────────────────

export async function provisionProject(input: ProvisionInput): Promise<void> {
  const { projectId, slug, dbName, dbUser } = input;
  const ramMbLimit  = input.ramMbLimit  ?? 2048;
  const vcpuLimit   = input.vcpuLimit   ?? 1;
  const apiUrl      = `${USE_TLS ? "https" : "http"}://${slug}.${BASE_DOMAIN}`;
  const siteUrl     = input.siteUrl ?? apiUrl;

  // 1. Generate secrets
  const secrets = await generateProjectSecrets();

  // 2. Create tenant database + user in shared baas-postgres
  await createTenantDatabase(dbName, dbUser, secrets.dbPassword);

  // 3. Start PostgREST and GoTrue in parallel (both connect to shared baas-postgres)
  const [restCfg, authCfg] = [
    restContainerConfig(slug, dbName, dbUser, secrets.dbPassword, secrets.jwtSecret, vcpuLimit, ramMbLimit),
    authContainerConfig(slug, dbName, secrets.dbPassword, secrets.jwtSecret, apiUrl, siteUrl, vcpuLimit, ramMbLimit),
  ];

  await Promise.all([
    runContainer(`baas-${slug}-rest`, restCfg),
    runContainer(`baas-${slug}-auth`, authCfg),
  ]);

  // 4. Persist endpoints + mark active
  await db.update(baasProjects)
    .set({
      dbHost:         BAAS_PG_HOST,
      dbPort:         BAAS_PG_PORT,
      dbPassword:     secrets.dbPassword,
      jwtSecret:      secrets.jwtSecret,
      anonKey:        secrets.anonKey,
      serviceRoleKey: secrets.serviceRoleKey,
      apiUrl,
      realtimeUrl: `${apiUrl}/realtime/v1`,
      storageUrl:  `${apiUrl}/storage/v1`,
      studioUrl:   null,   // Studio is not provisioned per-tenant in this model
      status:      "active",
      lastActivityAt: new Date(),
      updatedAt:      new Date(),
    })
    .where(eq(baasProjects.id, projectId));
}

export async function pauseProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project) throw new Error("Project not found");

  await Promise.all([
    stopContainer(`baas-${project.slug}-rest`),
    stopContainer(`baas-${project.slug}-auth`),
  ]);

  await db.update(baasProjects)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(baasProjects.id, projectId));
}

export async function resumeProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project) throw new Error("Project not found");

  await Promise.all([
    startContainer(`baas-${project.slug}-rest`),
    startContainer(`baas-${project.slug}-auth`),
  ]);

  await db.update(baasProjects)
    .set({ status: "active", lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(baasProjects.id, projectId));
}

export async function deleteProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project) return;

  await Promise.all([
    removeContainer(`baas-${project.slug}-rest`),
    removeContainer(`baas-${project.slug}-auth`),
  ]);

  await dropTenantDatabase(project.dbName, project.dbUser);
  await db.delete(baasProjects).where(eq(baasProjects.id, projectId));
}

export async function wakeProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project) throw new Error("Project not found");
  if (project.status === "active") return;
  if (project.status !== "paused") throw new Error(`Cannot wake project in status: ${project.status}`);
  await resumeProject(projectId);
}
