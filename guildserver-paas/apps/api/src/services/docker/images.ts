import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { broadcastToUser } from "../../websocket/server";
import { docker } from "./client";

export function detectDefaultPort(image: string): number {
  const img = image.toLowerCase();

  const portMap: Array<[RegExp | string, number]> = [
    [/grafana/, 3000],
    [/ghost/, 2368],
    [/strapi/, 1337],
    [/directus/, 8055],
    [/supabase\/studio/, 3000],
    [/plausible/, 8000],
    [/umami/, 3000],
    [/metabase/, 3000],
    [/minio/, 9000],
    [/gitea/, 3000],
    [/drone/, 80],
    [/nextcloud/, 80],
    [/wordpress/, 80],
    [/jenkins/, 8080],
    [/sonarqube/, 9000],
    [/portainer/, 9000],
    [/uptime-kuma/, 3001],
    [/outline/, 3000],
    [/appsmith/, 80],
    [/n8n/, 5678],
    [/nocodb/, 8080],
    [/hasura/, 8080],
    [/keycloak/, 8080],
    [/verdaccio/, 4873],
    [/registry/, 5000],
    [/traefik/, 8080],
    [/prometheus/, 9090],
    [/alertmanager/, 9093],
    [/node/, 3000],
    [/next/, 3000],
    [/nuxt/, 3000],
    [/remix/, 3000],
    [/vite/, 5173],
    [/flask/, 5000],
    [/django/, 8000],
    [/fastapi/, 8000],
    [/uvicorn/, 8000],
    [/gunicorn/, 8000],
    [/rails/, 3000],
    [/spring/, 8080],
    [/tomcat/, 8080],
    [/wildfly/, 8080],
    [/nginx/, 80],
    [/httpd/, 80],
    [/apache/, 80],
    [/caddy/, 80],
  ];

  for (const [pattern, port] of portMap) {
    if (pattern instanceof RegExp ? pattern.test(img) : img.includes(pattern)) {
      return port;
    }
  }

  return 80;
}

export interface RegistryAuth {
  username: string;
  password: string;
  /** Registry host, e.g. "ghcr.io" or "registry.example.com:5000". Defaults to Docker Hub. */
  serveraddress?: string;
}

export async function pullImage(
  image: string,
  tag: string,
  userId?: string,
  deploymentId?: string,
  dockerClient?: Docker,
  auth?: RegistryAuth,
): Promise<string[]> {
  const d = dockerClient || docker;
  const cleanImage = image.trim().replace(/:$/, "");
  const cleanTag = tag.trim() || "latest";
  const fullImage = `${cleanImage}:${cleanTag}`;
  const logs: string[] = [];

  // Build authconfig for private registries (dockerode forwards this as X-Registry-Auth).
  const authconfig = auth?.username
    ? {
        username: auth.username,
        password: auth.password,
        serveraddress: auth.serveraddress || "https://index.docker.io/v1/",
      }
    : undefined;

  const log = (msg: string) => {
    logs.push(msg);
    logger.info(`[pull] ${msg}`);
    if (userId && deploymentId) {
      broadcastToUser(userId, {
        type: "deployment_log",
        deploymentId,
        log: msg,
        phase: "pull",
      });
    }
  };

  log(`Pulling image ${fullImage}...`);

  try {
    const stream = await d.pull(fullImage, authconfig ? { authconfig } : {});

    await new Promise<void>((resolve, reject) => {
      d.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            log(`ERROR: Failed to pull ${fullImage}: ${err.message}`);
            reject(err);
          } else {
            log(`Successfully pulled ${fullImage}`);
            resolve();
          }
        },
        (event: any) => {
          if (event.status) {
            const detail = event.progress ? ` ${event.progress}` : "";
            log(`${event.status}${detail}`);
          }
        }
      );
    });

    return logs;
  } catch (error: any) {
    log(`ERROR: ${error.message}`);
    throw error;
  }
}
