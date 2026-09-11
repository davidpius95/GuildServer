/**
 * DockerRemoteProvider — deploys to a Docker daemon on another server, over
 * SSH (docker-modem runs `docker system dial-stdio` on the host) or over
 * Docker's TLS socket.
 *
 * The deploy, rolling-update and health-check code is the same code the local
 * provider uses, handed a client for the remote daemon. What differs:
 *   - images built on the control plane are copied to the host first;
 *   - health checks probe the host's address rather than a bridge IP;
 *   - optionally, GuildServer's Traefik runs on the host so domains route there.
 *
 * SSH host keys are pinned. A provider whose key has not been pinned yet (by a
 * successful connection test) will not deploy.
 */
import Docker from "dockerode";
import {
  deployContainer,
  ensureNetwork,
  getAppContainerInfo,
  getContainerLogs,
  getContainerStats,
  postDeployHealthCheck,
  removeExistingContainers,
  restartContainer,
  stopContainer,
  NETWORK_NAME,
  GS_LABELS,
} from "../services/docker";
import type { DeployOptions } from "../services/docker";
import { getLocalDockerClient, transferDockerImage } from "../services/node-docker";
import { logger } from "../utils/logger";
import type { Resolver } from "../utils/outbound-url";
import { decryptDockerRemoteConfig } from "./docker-remote-config";
import { RemoteHostError, assertRemoteHostAllowed, normalizeRemoteHost } from "./remote-host";
import { pinnedHostVerifier, probeSsh, type SshProbeResult } from "./ssh-host-key";
import type {
  ComputeProvider,
  ConnectionTestResult,
  DeployConfig,
  DeployResult,
  DockerRemoteConfig,
  HealthResult,
  ProviderType,
  WorkloadInfo,
  WorkloadMetrics,
} from "./types";

export const REMOTE_PROXY_IMAGE = "traefik:v3.1";
export const REMOTE_PROXY_NAME = "gs-proxy";
const PROXY_ROLE_LABEL = "gs.role";
const PROXY_ROLE = "proxy";

export interface DockerRemoteDeps {
  createClient?: (config: DockerRemoteConfig, hostVerifier: (key: Buffer) => boolean) => Docker;
  localDocker?: () => Docker;
  transferImage?: typeof transferDockerImage;
  probe?: (options: Parameters<typeof probeSsh>[0]) => Promise<SshProbeResult>;
  env?: NodeJS.ProcessEnv;
  resolve?: Resolver;
}

export function createRemoteDockerClient(config: DockerRemoteConfig, hostVerifier: (key: Buffer) => boolean): Docker {
  if (config.connectionType === "tls") {
    return new Docker({ protocol: "https", host: config.host, port: config.port, ca: config.tlsCa, cert: config.tlsCert, key: config.tlsKey });
  }
  return new Docker({
    protocol: "ssh",
    host: config.host,
    port: config.port,
    username: config.sshUser,
    sshOptions: {
      privateKey: config.sshKey,
      password: config.sshPassword,
      hostVerifier,
      readyTimeout: 20_000,
    },
  } as Docker.DockerOptions);
}

export class DockerRemoteProvider implements ComputeProvider {
  readonly type: ProviderType = "docker-remote";
  private readonly stored: DockerRemoteConfig;
  private readonly deps: Required<Omit<DockerRemoteDeps, "resolve">> & Pick<DockerRemoteDeps, "resolve">;
  private hostChecked = false;
  private clientInstance: Docker | null = null;

  constructor(config: DockerRemoteConfig, private readonly providerId?: string, deps: DockerRemoteDeps = {}) {
    this.stored = { ...config, host: normalizeRemoteHost(String(config.host ?? "")) };
    this.deps = {
      createClient: deps.createClient ?? createRemoteDockerClient,
      localDocker: deps.localDocker ?? getLocalDockerClient,
      transferImage: deps.transferImage ?? transferDockerImage,
      probe: deps.probe ?? probeSsh,
      env: deps.env ?? process.env,
      resolve: deps.resolve,
    };
  }

  get host(): string {
    return this.stored.host;
  }

  /** The remote daemon's client. Refuses unsafe hosts and unpinned SSH keys. */
  private async client(): Promise<Docker> {
    if (!this.hostChecked) {
      await assertRemoteHostAllowed(this.stored.host, this.deps.env, this.deps.resolve);
      this.hostChecked = true;
    }
    if (this.stored.connectionType !== "tls" && !this.stored.hostKeyFingerprint) {
      throw new Error("This remote Docker host's SSH key is not pinned yet. Run a connection test on the provider first.");
    }
    if (!this.clientInstance) {
      const plain = decryptDockerRemoteConfig(this.stored);
      this.clientInstance = this.deps.createClient(plain, pinnedHostVerifier(plain.hostKeyFingerprint));
    }
    return this.clientInstance;
  }

  async deploy(config: DeployConfig): Promise<DeployResult> {
    const client = await this.client();
    const logs: string[] = [];
    const image = `${config.dockerImage}:${config.dockerTag}`;

    if (config.dockerImage.startsWith("gs-")) {
      logs.push(`Copying locally built image ${image} to ${this.host}...`);
      await this.deps.transferImage(image, this.deps.localDocker(), client);
      logs.push("Image copied");
    }

    if (this.stored.manageProxy) {
      logs.push(...(await this.ensureProxy(client)));
    }

    const opts: DeployOptions = {
      deploymentId: config.deploymentId,
      applicationId: config.applicationId,
      appName: config.appName,
      projectId: config.projectId,
      userId: config.userId,
      dockerImage: config.dockerImage,
      dockerTag: config.dockerTag,
      environment: config.environment,
      memoryLimit: config.memoryLimit,
      cpuLimit: config.cpuLimit,
      replicas: config.replicas,
      sourceType: config.sourceType,
      domains: config.domains,
      containerPort: config.containerPort,
      persistentStoragePath: config.persistentStoragePath,
      registryAuth: config.registryAuth,
      applicationConfig: config.applicationConfig,
      probeHost: this.host,
    };
    const result = await deployContainer(opts, client);

    return {
      containerId: result.containerId,
      containerName: result.containerName,
      hostPort: result.hostPort,
      logs: [...logs, ...result.logs],
      providerMetadata: { provider: "docker-remote", providerId: this.providerId, remoteHost: this.host },
      strategy: result.strategy,
      candidateContainerId: result.candidateContainerId,
      previousContainerId: result.previousContainerId,
    };
  }

  /** The post-deploy health check, run against the host rather than a local bridge IP. */
  async verifyDeployment(opts: {
    containerId: string;
    hostPort: number;
    expectedContainerPort: number;
    userId?: string;
    deploymentId?: string;
    maxWaitMs?: number;
  }) {
    const client = await this.client();
    return postDeployHealthCheck({ ...opts, dockerClient: client, probeHost: this.host });
  }

  /**
   * Make sure GuildServer's Traefik is running on the host. Only called when
   * the provider has manageProxy enabled, because it binds ports 80 and 443.
   */
  async ensureProxy(client: Docker): Promise<string[]> {
    const existing = await client.listContainers({ all: true, filters: { label: [`${PROXY_ROLE_LABEL}=${PROXY_ROLE}`] } });
    if (existing.some((c) => c.State === "running")) return [];
    if (existing.length > 0) {
      await client.getContainer(existing[0].Id).start();
      return [`Started the stopped proxy on ${this.host}`];
    }

    await ensureNetwork(client);
    await new Promise<void>((resolve, reject) => {
      client.pull(REMOTE_PROXY_IMAGE, (error: Error | null, stream: NodeJS.ReadableStream) => {
        if (error) return reject(error);
        client.modem.followProgress(stream, (progressError: Error | null) => (progressError ? reject(progressError) : resolve()));
      });
    });

    const acmeEmail = this.deps.env.ACME_EMAIL;
    const proxy = await client.createContainer({
      name: REMOTE_PROXY_NAME,
      Image: REMOTE_PROXY_IMAGE,
      Cmd: [
        "--providers.docker=true",
        "--providers.docker.exposedbydefault=false",
        `--providers.docker.network=${NETWORK_NAME}`,
        "--entrypoints.web.address=:80",
        "--entrypoints.websecure.address=:443",
        "--certificatesresolvers.letsencrypt.acme.httpchallenge=true",
        "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web",
        "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json",
        ...(acmeEmail ? [`--certificatesresolvers.letsencrypt.acme.email=${acmeEmail}`] : []),
      ],
      Labels: { [GS_LABELS.MANAGED]: "true", [PROXY_ROLE_LABEL]: PROXY_ROLE },
      ExposedPorts: { "80/tcp": {}, "443/tcp": {} },
      HostConfig: {
        PortBindings: { "80/tcp": [{ HostPort: "80" }], "443/tcp": [{ HostPort: "443" }] },
        Binds: ["/var/run/docker.sock:/var/run/docker.sock:ro", "gs-proxy-letsencrypt:/letsencrypt"],
        RestartPolicy: { Name: "unless-stopped" },
        NetworkMode: NETWORK_NAME,
      },
    });
    await proxy.start();
    logger.info("Started GuildServer proxy on remote Docker host", { host: this.host, providerId: this.providerId });
    return [`Started GuildServer's proxy (${REMOTE_PROXY_IMAGE}) on ${this.host}`];
  }

  async stop(applicationId: string): Promise<void> {
    await stopContainer(applicationId, await this.client());
  }

  async restart(applicationId: string): Promise<boolean> {
    return restartContainer(applicationId, await this.client());
  }

  async remove(applicationId: string): Promise<void> {
    await removeExistingContainers(applicationId, undefined, await this.client());
  }

  async getLogs(applicationId: string, lines?: number): Promise<string[]> {
    return getContainerLogs(applicationId, lines, await this.client());
  }

  async getMetrics(applicationId: string): Promise<WorkloadMetrics | null> {
    const stats = await getContainerStats(applicationId, await this.client());
    if (!stats) return null;
    return {
      cpuPercent: stats.cpuPercent,
      memoryUsageMb: stats.memoryUsageMb,
      memoryLimitMb: stats.memoryLimitMb,
      memoryPercent: stats.memoryPercent,
      networkRxBytes: stats.networkRxBytes,
      networkTxBytes: stats.networkTxBytes,
    };
  }

  async getInfo(applicationId: string): Promise<WorkloadInfo | null> {
    const info = await getAppContainerInfo(applicationId, await this.client());
    if (!info) return null;
    return { ...info, providerMetadata: { provider: "docker-remote", remoteHost: this.host } };
  }

  async healthCheck(applicationId: string): Promise<HealthResult> {
    const info = await getAppContainerInfo(applicationId, await this.client());
    return {
      healthy: info?.status === "running",
      status: info?.status || "not_found",
      message: info ? `Container ${info.containerName} is ${info.status} on ${this.host}` : `No container found on ${this.host}`,
      checkedAt: new Date(),
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await assertRemoteHostAllowed(this.stored.host, this.deps.env, this.deps.resolve);
    } catch (error) {
      if (error instanceof RemoteHostError) return { connected: false, message: error.message };
      throw error;
    }
    const plain = decryptDockerRemoteConfig(this.stored);

    let fingerprint: string | undefined;
    if (plain.connectionType !== "tls") {
      const probe = await this.deps.probe({
        host: plain.host,
        port: plain.port,
        username: plain.sshUser,
        privateKey: plain.sshKey,
        password: plain.sshPassword,
        expectedFingerprint: plain.hostKeyFingerprint,
      });
      if (!probe.authenticated) {
        return {
          connected: false,
          message: probe.error ?? "SSH connection failed",
          details: probe.fingerprint && !probe.keyMismatch ? { hostKeyFingerprint: probe.fingerprint } : undefined,
        };
      }
      fingerprint = probe.fingerprint;
    }

    // Pin the Docker connection to the key the probe just verified, so the
    // host cannot be swapped between the two connections.
    const client = this.deps.createClient(plain, pinnedHostVerifier(plain.hostKeyFingerprint ?? fingerprint));
    try {
      const [version, info] = await Promise.all([client.version(), client.info()]);
      return {
        connected: true,
        message: `Connected to Docker ${version.Version} on ${info.Name || plain.host}`,
        details: {
          version: version.Version,
          resources: { cpuCores: info.NCPU, memoryMb: Math.round((info.MemTotal ?? 0) / 1_048_576) },
          hostKeyFingerprint: fingerprint,
        },
      };
    } catch {
      return {
        connected: false,
        message:
          plain.connectionType === "tls"
            ? "Docker's TLS socket did not respond with these certificates"
            : "Logged in over SSH, but Docker did not respond. Is Docker installed, and can this user run it?",
        details: fingerprint ? { hostKeyFingerprint: fingerprint } : undefined,
      };
    }
  }
}
