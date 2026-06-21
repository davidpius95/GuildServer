import { docker, NETWORK_NAME, GS_LABELS } from "./docker/client";
import { ensureNetwork } from "./docker/networks";
import { pullImage } from "./docker/images";
import { removeExistingContainers } from "./docker/container";
import { logger } from "../utils/logger";

/** Native listen port per database engine. */
const DB_PORTS: Record<string, number> = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongodb: 27017,
  redis: 6379,
};

/** In-container data directory per engine, mounted on a persistent volume. */
const DB_DATA_DIRS: Record<string, string> = {
  postgresql: "/var/lib/postgresql/data",
  mysql: "/var/lib/mysql",
  mariadb: "/var/lib/mysql",
  mongodb: "/data/db",
  redis: "/data",
};

/** Stable named-volume identifier for a database's persistent data. */
export function dbVolumeName(databaseId: string): string {
  return `gs-db-${databaseId.slice(0, 12)}-data`;
}

/** Create the data volume if it does not already exist (idempotent). */
async function ensureVolume(name: string): Promise<void> {
  try {
    await docker.getVolume(name).inspect();
  } catch {
    await docker.createVolume({
      Name: name,
      Labels: { [GS_LABELS.MANAGED]: "true", [GS_LABELS.TYPE]: "database" },
    });
  }
}

/** Default image per engine (matches database router defaults). */
const DEFAULT_IMAGES: Record<string, string> = {
  postgresql: "postgres:15",
  mysql: "mysql:8.0",
  mariadb: "mariadb:10.11",
  mongodb: "mongo:7.0",
  redis: "redis:7-alpine",
};

/** Build the correct env vars / command the official image expects. */
function buildEngineConfig(
  type: string,
  databaseName: string,
  username: string,
  password: string
): { env: string[]; cmd?: string[] } {
  switch (type) {
    case "postgresql":
      return {
        env: [
          `POSTGRES_DB=${databaseName}`,
          `POSTGRES_USER=${username}`,
          `POSTGRES_PASSWORD=${password}`,
        ],
      };
    case "mysql":
    case "mariadb":
      return {
        env: [
          `MYSQL_DATABASE=${databaseName}`,
          `MYSQL_USER=${username}`,
          `MYSQL_PASSWORD=${password}`,
          `MYSQL_ROOT_PASSWORD=${password}`,
        ],
      };
    case "mongodb":
      return {
        env: [
          `MONGO_INITDB_DATABASE=${databaseName}`,
          `MONGO_INITDB_ROOT_USERNAME=${username}`,
          `MONGO_INITDB_ROOT_PASSWORD=${password}`,
        ],
      };
    case "redis":
      return { env: [], cmd: ["redis-server", "--requirepass", password] };
    default:
      return { env: [] };
  }
}

async function findAvailablePort(): Promise<number> {
  // Pick a free host port in a high range, avoiding ones already bound by managed containers.
  const inUse = new Set<number>();
  const containers = await docker.listContainers({ all: true });
  for (const c of containers) {
    for (const p of c.Ports || []) if (p.PublicPort) inUse.add(p.PublicPort);
  }
  for (let i = 0; i < 200; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    if (!inUse.has(port)) return port;
  }
  throw new Error("No available host port for database");
}

export interface ProvisionResult {
  containerId: string;
  hostPort: number;
  volumeName: string;
}

/**
 * Provision and start a real database container, labelled with the database id so
 * restartContainer/removeExistingContainers (keyed on gs.app.id) work against it.
 */
export async function provisionDatabaseContainer(opts: {
  databaseId: string;
  name: string;
  type: string;
  dockerImage?: string | null;
  databaseName: string;
  username: string;
  password: string;
}): Promise<ProvisionResult> {
  const image = opts.dockerImage || DEFAULT_IMAGES[opts.type];
  if (!image) throw new Error(`Unknown database type: ${opts.type}`);
  const containerPort = DB_PORTS[opts.type];
  if (!containerPort) throw new Error(`Unknown database type: ${opts.type}`);

  await ensureNetwork();
  // Clean up any prior container for this database id (idempotent). The data
  // volume is intentionally left intact so data survives redeploys/restarts.
  await removeExistingContainers(opts.databaseId);
  await pullImage(image, "latest", "system", `db-${opts.databaseId}`);

  // Ensure a persistent volume backs the engine's data directory.
  const volumeName = dbVolumeName(opts.databaseId);
  const dataDir = DB_DATA_DIRS[opts.type];
  await ensureVolume(volumeName);

  const hostPort = await findAvailablePort();
  const { env, cmd } = buildEngineConfig(
    opts.type,
    opts.databaseName,
    opts.username,
    opts.password
  );

  const portKey = `${containerPort}/tcp`;
  const container = await docker.createContainer({
    name: `gs-db-${opts.databaseId.slice(0, 12)}`,
    Image: image,
    Env: env,
    ...(cmd ? { Cmd: cmd } : {}),
    Labels: {
      [GS_LABELS.MANAGED]: "true",
      [GS_LABELS.APP_ID]: opts.databaseId,
      [GS_LABELS.APP_NAME]: opts.name,
      [GS_LABELS.TYPE]: "database",
    },
    ExposedPorts: { [portKey]: {} },
    HostConfig: {
      PortBindings: { [portKey]: [{ HostPort: String(hostPort) }] },
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode: NETWORK_NAME,
      ...(dataDir ? { Binds: [`${volumeName}:${dataDir}`] } : {}),
    },
  });

  await container.start();
  logger.info(`Provisioned ${opts.type} database ${opts.name} (${opts.databaseId}) on host port ${hostPort}`);
  return { containerId: container.id, hostPort, volumeName };
}

/** Remove a database's persistent data volume. Only call when destroying data. */
export async function removeDatabaseVolume(databaseId: string): Promise<void> {
  const name = dbVolumeName(databaseId);
  try {
    await docker.getVolume(name).remove({ force: true });
    logger.info(`Removed data volume ${name} for database ${databaseId}`);
  } catch (err: any) {
    logger.warn(`Failed to remove volume ${name}: ${err.message}`);
  }
}
