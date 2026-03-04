// Provider Types for Multi-Cloud Infrastructure Abstraction
// Each compute provider (Docker Local, Docker Remote, Proxmox, K8s, AWS ECS, etc.)
// implements the ComputeProvider interface.

export type ProviderType =
  | "docker-local"
  | "docker-remote"
  | "proxmox"
  | "kubernetes"
  | "aws-ecs"
  | "gcp-cloudrun"
  | "azure-aci"
  | "hetzner"
  | "digitalocean";

export type ProviderStatus = "pending" | "connected" | "error" | "disabled";

// Configuration types for each provider
export interface DockerLocalConfig {
  socketPath?: string; // defaults to platform default
  networkName?: string; // defaults to "guildserver"
}

export interface DockerRemoteConfig {
  connectionType: "ssh" | "tls";
  host: string;
  port: number;
  // SSH
  sshUser?: string;
  sshKey?: string; // encrypted
  sshPassword?: string; // encrypted
  // TLS
  tlsCa?: string;
  tlsCert?: string;
  tlsKey?: string;
}

export interface ProxmoxConfig {
  host: string;
  port: number; // default 8006
  tokenId: string; // e.g. "root@pam!guildserver"
  tokenSecret: string; // encrypted
  node: string; // Proxmox node name
  storage: string; // Storage pool
  bridge: string; // Network bridge
  templateVmId?: number;
  deployMode?: "lxc" | "qemu";
}

export interface KubernetesConfig {
  kubeconfig: string; // encrypted
  namespace: string;
  ingressClass?: string;
  certManagerIssuer?: string;
}

export interface AWSECSConfig {
  region: string;
  accessKeyId: string; // encrypted
  secretAccessKey: string; // encrypted
  ecsClusterArn?: string;
  vpcId?: string;
  subnetIds?: string[];
  securityGroupIds?: string[];
  executionRoleArn?: string;
  taskRoleArn?: string;
}

export interface GCPCloudRunConfig {
  projectId: string;
  region: string;
  serviceAccountKey: string; // encrypted JSON
}

export type ProviderConfig =
  | DockerLocalConfig
  | DockerRemoteConfig
  | ProxmoxConfig
  | KubernetesConfig
  | AWSECSConfig
  | GCPCloudRunConfig
  | Record<string, unknown>; // for future providers

// Deploy configuration passed to providers
export interface DeployConfig {
  deploymentId: string;
  applicationId: string;
  appName: string;
  projectId: string;
  userId: string;
  dockerImage: string;
  dockerTag: string;
  environment: Record<string, string>;
  memoryLimit?: number | null;
  cpuLimit?: number | string | null;
  replicas?: number;
  sourceType: string;
  domains?: string[];
  containerPort?: number;
}

// Result from a deployment
export interface DeployResult {
  containerId: string;
  containerName: string;
  hostPort: number;
  logs: string[];
  providerMetadata?: Record<string, unknown>; // provider-specific info
}

// Container/workload info
export interface WorkloadInfo {
  containerId: string;
  containerName: string;
  status: string;
  ports: Array<{ hostPort: number; containerPort: number }>;
  image: string;
  created: Date;
  providerMetadata?: Record<string, unknown>;
}

// Container/workload metrics
export interface WorkloadMetrics {
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

// Health check result
export interface HealthResult {
  healthy: boolean;
  status: string;
  message?: string;
  checkedAt: Date;
}

// Connection test result (for testing provider connectivity)
export interface ConnectionTestResult {
  connected: boolean;
  message: string;
  details?: {
    version?: string;
    resources?: {
      cpuCores?: number;
      memoryMb?: number;
      storageMb?: number;
    };
    nodeCount?: number;
  };
}

/**
 * ComputeProvider is the core interface that all infrastructure providers implement.
 * This abstraction allows GuildServer to deploy to any backend (Docker, Proxmox, K8s, AWS, etc.)
 * through a unified API.
 */
export interface ComputeProvider {
  /** The provider type identifier */
  readonly type: ProviderType;

  // === Lifecycle ===

  /** Deploy an application workload */
  deploy(config: DeployConfig): Promise<DeployResult>;

  /** Stop a running workload */
  stop(applicationId: string): Promise<void>;

  /** Restart a workload */
  restart(applicationId: string): Promise<boolean>;

  /** Remove a workload completely */
  remove(applicationId: string): Promise<void>;

  // === Observability ===

  /** Get logs from a workload */
  getLogs(applicationId: string, lines?: number): Promise<string[]>;

  /** Get real-time metrics from a workload */
  getMetrics(applicationId: string): Promise<WorkloadMetrics | null>;

  /** Get workload info (status, ports, etc.) */
  getInfo(applicationId: string): Promise<WorkloadInfo | null>;

  /** Run a health check on a workload */
  healthCheck(applicationId: string): Promise<HealthResult>;

  // === Connection ===

  /** Test connectivity to the provider */
  testConnection(): Promise<ConnectionTestResult>;
}

// Provider plugin metadata (for dynamic UI rendering)
export interface ProviderPluginMeta {
  type: ProviderType;
  name: string;
  description: string;
  icon: string; // icon identifier for the UI
  configSchema: ProviderConfigField[];
}

export interface ProviderConfigField {
  name: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "textarea" | "boolean";
  required: boolean;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  description?: string;
  options?: Array<{ label: string; value: string }>; // for select type
}
