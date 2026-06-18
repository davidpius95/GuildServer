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
};

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
