import {
  ComputeProvider,
  DeployConfig,
  DeployResult,
  WorkloadInfo,
  WorkloadMetrics,
  HealthResult,
  ConnectionTestResult,
  DockerLocalConfig,
  ProviderType,
} from "./types";
import {
  deployContainer,
  getAppContainerInfo,
  getContainerLogs,
  getContainerStats,
  restartContainer,
  stopContainer,
  removeExistingContainers,
  testDockerConnection,
} from "../services/docker";
import type { DeployOptions } from "../services/docker";

/**
 * DockerLocalProvider — deploys to the local Docker daemon.
 * This is the default provider, wrapping the existing docker.ts service
 * behind the ComputeProvider interface.
 */
export class DockerLocalProvider implements ComputeProvider {
  readonly type: ProviderType = "docker-local";
  private config: DockerLocalConfig;

  constructor(config?: DockerLocalConfig) {
    this.config = config || {};
  }

  async deploy(config: DeployConfig): Promise<DeployResult> {
    // Map DeployConfig to the existing DeployOptions interface
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
    };

    const result = await deployContainer(opts);

    return {
      containerId: result.containerId,
      containerName: result.containerName,
      hostPort: result.hostPort,
      logs: result.logs,
      providerMetadata: { provider: "docker-local" },
    };
  }

  async stop(applicationId: string): Promise<void> {
    await stopContainer(applicationId);
  }

  async restart(applicationId: string): Promise<boolean> {
    return restartContainer(applicationId);
  }

  async remove(applicationId: string): Promise<void> {
    await removeExistingContainers(applicationId);
  }

  async getLogs(applicationId: string, lines?: number): Promise<string[]> {
    return getContainerLogs(applicationId, lines);
  }

  async getMetrics(applicationId: string): Promise<WorkloadMetrics | null> {
    const stats = await getContainerStats(applicationId);
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
    const info = await getAppContainerInfo(applicationId);
    if (!info) return null;

    return {
      containerId: info.containerId,
      containerName: info.containerName,
      status: info.status,
      ports: info.ports,
      image: info.image,
      created: info.created,
      providerMetadata: { provider: "docker-local" },
    };
  }

  async healthCheck(applicationId: string): Promise<HealthResult> {
    const info = await getAppContainerInfo(applicationId);

    return {
      healthy: info?.status === "running",
      status: info?.status || "not_found",
      message: info ? `Container ${info.containerName} is ${info.status}` : "No container found",
      checkedAt: new Date(),
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const connected = await testDockerConnection();

    return {
      connected,
      message: connected
        ? "Successfully connected to local Docker daemon"
        : "Failed to connect to Docker daemon. Ensure Docker is running.",
    };
  }
}
