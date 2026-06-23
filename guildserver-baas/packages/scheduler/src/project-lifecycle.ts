import { NodeSSH } from "node-ssh";
import { db, baasNodes, baasProjects } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";
import { selectNode, allocatePortBase, incrementNodeUsage, decrementNodeUsage } from "./node-selector";
import { generateProjectSecrets } from "./secrets";
import { generateComposeYml, generateKongConfig, generatePostgresqlConf } from "./compose-template";

const BASE_DOMAIN = process.env.BAAS_BASE_DOMAIN ?? "baas.localhost";

export interface ProvisionInput {
  projectId: string;
  slug: string;
  organizationId: string;
  dbName: string;
  dbUser: string;
  ramMbLimit?: number;
  vcpuLimit?: number;
  storageGbLimit?: number;
  siteUrl?: string;
}

async function sshConnect(node: typeof baasNodes.$inferSelect): Promise<NodeSSH> {
  const ssh = new NodeSSH();
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

export async function provisionProject(input: ProvisionInput): Promise<void> {
  const { projectId, slug } = input;
  const ramMbLimit     = input.ramMbLimit     ?? 2048;
  const vcpuLimit      = input.vcpuLimit      ?? 1;
  const storageGbLimit = input.storageGbLimit ?? 8;

  // 1. Select compute node
  const nodeId = await selectNode({ minRamMb: ramMbLimit, minStorageGb: storageGbLimit });
  if (!nodeId) throw new Error("No eligible compute node available");

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, nodeId));
  if (!node) throw new Error(`Node ${nodeId} not found`);

  // 2. Generate secrets & port base
  const secrets     = await generateProjectSecrets();
  const portBase    = await allocatePortBase(nodeId);
  const apiUrl      = `http://${node.externalIp ?? node.hostname}:${portBase}`;
  const studioUrl   = `http://${node.externalIp ?? node.hostname}:${portBase + 2}`;

  // 3. Generate compose files
  const composeYml   = generateComposeYml({
    projectSlug: slug,
    dbName: input.dbName,
    dbUser: input.dbUser,
    dbPassword: secrets.dbPassword,
    jwtSecret: secrets.jwtSecret,
    anonKey: secrets.anonKey,
    serviceRoleKey: secrets.serviceRoleKey,
    apiExternalUrl: apiUrl,
    siteUrl: input.siteUrl ?? apiUrl,
    hostPortBase: portBase,
    ramMbLimit,
    vcpuLimit,
  });
  const kongYml     = generateKongConfig({ anonKey: secrets.anonKey, serviceRoleKey: secrets.serviceRoleKey });
  const pgConf      = generatePostgresqlConf(ramMbLimit, false);
  const projectDir  = `/opt/baas/${slug}`;

  // 4. SSH in, write files, start stack
  const ssh = await sshConnect(node);
  try {
    await ssh.execCommand(`mkdir -p ${projectDir}/volumes/api ${projectDir}/volumes/db ${projectDir}/volumes/storage ${projectDir}/volumes/functions`);
    const sftp = await ssh.requestSFTP();
    await new Promise<void>((res, rej) => sftp.writeFile(`${projectDir}/docker-compose.yml`, composeYml, {}, (e: any) => e ? rej(e) : res()));
    await new Promise<void>((res, rej) => sftp.writeFile(`${projectDir}/volumes/api/kong.yml`, kongYml, {}, (e: any) => e ? rej(e) : res()));
    await new Promise<void>((res, rej) => sftp.writeFile(`${projectDir}/volumes/db/postgresql.conf`, pgConf, {}, (e: any) => e ? rej(e) : res()));

    const pull = await ssh.execCommand("docker compose pull", { cwd: projectDir });
    if (pull.code !== 0) throw new Error(`docker compose pull failed: ${pull.stderr}`);

    const up = await ssh.execCommand("docker compose up -d", { cwd: projectDir });
    if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
  } finally {
    ssh.dispose();
  }

  // 5. Persist to DB
  await db.update(baasProjects)
    .set({
      nodeId,
      hostPortBase: portBase,
      dbPassword:     secrets.dbPassword,
      jwtSecret:      secrets.jwtSecret,
      anonKey:        secrets.anonKey,
      serviceRoleKey: secrets.serviceRoleKey,
      apiUrl,
      realtimeUrl: `${apiUrl}/realtime/v1`,
      storageUrl:  `${apiUrl}/storage/v1`,
      studioUrl,
      status: "active",
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(baasProjects.id, projectId));

  await incrementNodeUsage(nodeId, { ramMb: ramMbLimit, storageGb: storageGbLimit, vcpu: vcpuLimit });
}

export async function pauseProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project?.nodeId) throw new Error("Project has no node");

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) throw new Error("Node not found");

  const ssh = await sshConnect(node);
  try {
    // Stop all containers except the DB (preserve data, don't waste RAM on app services)
    await ssh.execCommand(`docker compose stop kong auth rest realtime storage imgproxy meta functions studio supavisor`, {
      cwd: `/opt/baas/${project.slug}`,
    });
  } finally {
    ssh.dispose();
  }

  await db.update(baasProjects)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(baasProjects.id, projectId));
}

export async function resumeProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project?.nodeId) throw new Error("Project has no node");

  const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
  if (!node) throw new Error("Node not found");

  const ssh = await sshConnect(node);
  try {
    const up = await ssh.execCommand("docker compose up -d", { cwd: `/opt/baas/${project.slug}` });
    if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
  } finally {
    ssh.dispose();
  }

  await db.update(baasProjects)
    .set({ status: "active", lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(baasProjects.id, projectId));
}

export async function deleteProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project) return;

  if (project.nodeId) {
    const [node] = await db.select().from(baasNodes).where(eq(baasNodes.id, project.nodeId));
    if (node) {
      const ssh = await sshConnect(node);
      try {
        await ssh.execCommand("docker compose down -v --remove-orphans", { cwd: `/opt/baas/${project.slug}` });
        await ssh.execCommand(`rm -rf /opt/baas/${project.slug}`);
      } finally {
        ssh.dispose();
      }
      await decrementNodeUsage(project.nodeId, {
        ramMb:     project.ramMbLimit    ? Number(project.ramMbLimit)    : 2048,
        storageGb: project.storageGbLimit ?? 8,
        vcpu:      project.vcpuLimit     ? Number(project.vcpuLimit)     : 1,
      });
    }
  }

  await db.delete(baasProjects).where(eq(baasProjects.id, projectId));
}

// Called when a request hits a paused project (auto-wake)
export async function wakeProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId));
  if (!project) throw new Error("Project not found");
  if (project.status === "active") return;
  if (project.status !== "paused") throw new Error(`Cannot wake project in status: ${project.status}`);
  await resumeProject(projectId);
}
