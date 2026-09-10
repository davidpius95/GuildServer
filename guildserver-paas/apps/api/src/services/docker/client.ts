import Docker from "dockerode";

export const docker = new Docker({
  socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
});

export const NETWORK_NAME = "guildserver";
export const CONTAINER_PREFIX = "gs";

export const GS_LABELS = {
  MANAGED: "gs.managed",
  APP_ID: "gs.app.id",
  APP_NAME: "gs.app.name",
  DEPLOYMENT_ID: "gs.deployment.id",
  PROJECT_ID: "gs.project.id",
  TYPE: "gs.type",

  /**
   * Stack-scoped labels for Compose services.
   *
   * `SERVICE_ID` is the one that matters. It carries the stack's row UUID, so
   * every destructive operation on a stack — stop, restart, delete, orphan
   * sweep — filters on a globally unique value rather than on a name prefix.
   * Name prefixes are how `gs-api` cleanup takes out `gs-api-gateway`; a UUID
   * cannot do that.
   */
  SERVICE_ID: "gs.service.id",
  SERVICE_NAME: "gs.service.name",
  /** The key under `services:` in the user's Compose file. */
  COMPOSE_SERVICE: "gs.compose.service",
  /** The `docker compose -p` project name we deployed the stack under. */
  COMPOSE_PROJECT: "gs.compose.project",
};

/** Value of `GS_LABELS.TYPE` for resources belonging to a Compose stack. */
export const GS_TYPE_SERVICE = "service";

export function isLocalhostDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    d === "localhost" ||
    d.endsWith(".localhost") ||
    d.endsWith(".local") ||
    d.endsWith(".test") ||
    d.endsWith(".example") ||
    d === "127.0.0.1" ||
    d.startsWith("192.168.") ||
    d.startsWith("10.") ||
    d.startsWith("172.16.")
  );
}

export function getDockerClient(): Docker {
  return docker;
}
