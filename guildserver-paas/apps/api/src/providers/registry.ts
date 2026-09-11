import { ProviderType, ProviderPluginMeta, ProviderConfigField } from "./types";

// Config schema definitions for each provider type
const dockerLocalFields: ProviderConfigField[] = [
  {
    name: "socketPath",
    label: "Docker Socket Path",
    type: "text",
    required: false,
    placeholder: "/var/run/docker.sock",
    description: "Path to Docker socket. Leave empty for auto-detection.",
  },
  {
    name: "networkName",
    label: "Docker Network",
    type: "text",
    required: false,
    defaultValue: "guildserver",
    description: "Docker network name for container communication.",
  },
];

const dockerRemoteFields: ProviderConfigField[] = [
  {
    name: "connectionType",
    label: "Connection Type",
    type: "select",
    required: true,
    options: [
      { label: "SSH Tunnel", value: "ssh" },
      { label: "TLS Direct", value: "tls" },
    ],
    description: "How to connect to the remote Docker daemon.",
  },
  { name: "host", label: "Host", type: "text", required: true, placeholder: "192.168.1.100" },
  { name: "port", label: "Port", type: "number", required: true, defaultValue: 22, description: "22 for SSH; 2376 for Docker's TLS socket." },
  { name: "sshUser", label: "SSH User", type: "text", required: false, placeholder: "deploy", description: "Must be able to run docker (root or a member of the docker group)." },
  { name: "sshKey", label: "SSH Private Key", type: "textarea", required: false, description: "Unencrypted private key. Stored encrypted and never shown again." },
  { name: "sshPassword", label: "SSH Password", type: "password", required: false, description: "Used only if no private key is given." },
  {
    name: "hostKeyFingerprint",
    label: "Host Key Fingerprint",
    type: "text",
    required: false,
    placeholder: "SHA256:…",
    description: "Optional. From `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. If empty, the key seen on the first successful connection is pinned.",
  },
  { name: "tlsCa", label: "TLS CA Certificate", type: "textarea", required: false, description: "TLS connections only." },
  { name: "tlsCert", label: "TLS Client Certificate", type: "textarea", required: false, description: "TLS connections only." },
  { name: "tlsKey", label: "TLS Client Key", type: "textarea", required: false, description: "TLS connections only. Stored encrypted." },
  {
    name: "manageProxy",
    label: "Run GuildServer's proxy on this host",
    type: "boolean",
    required: false,
    defaultValue: false,
    description: "Starts Traefik on ports 80/443 so app domains can point at this host. Leave off if something else already serves those ports.",
  },
];

const proxmoxFields: ProviderConfigField[] = [
  { name: "host", label: "Proxmox Host", type: "text", required: true, placeholder: "192.168.1.100" },
  { name: "port", label: "API Port", type: "number", required: true, defaultValue: 8006 },
  { name: "tokenId", label: "API Token ID", type: "text", required: true, placeholder: "root@pam!guildserver" },
  { name: "tokenSecret", label: "API Token Secret", type: "password", required: true },
  { name: "node", label: "Node Name", type: "text", required: true, placeholder: "pve" },
  { name: "storage", label: "Storage Pool", type: "text", required: true, defaultValue: "local-lvm" },
  { name: "bridge", label: "Network Bridge", type: "text", required: true, defaultValue: "vmbr0" },
  {
    name: "deployMode",
    label: "Deploy Mode",
    type: "select",
    required: false,
    defaultValue: "lxc",
    options: [
      { label: "LXC Container (lightweight)", value: "lxc" },
      { label: "QEMU VM (full isolation)", value: "qemu" },
    ],
  },
];

const kubernetesFields: ProviderConfigField[] = [
  { name: "kubeconfig", label: "Kubeconfig", type: "textarea", required: true, description: "Paste your kubeconfig YAML" },
  { name: "namespace", label: "Namespace", type: "text", required: true, defaultValue: "default" },
  { name: "ingressClass", label: "Ingress Class", type: "text", required: false, defaultValue: "nginx" },
  { name: "certManagerIssuer", label: "Cert-Manager Issuer", type: "text", required: false, placeholder: "letsencrypt-prod" },
];

const awsEcsFields: ProviderConfigField[] = [
  {
    name: "region",
    label: "AWS Region",
    type: "select",
    required: true,
    options: [
      { label: "US East (N. Virginia)", value: "us-east-1" },
      { label: "US West (Oregon)", value: "us-west-2" },
      { label: "EU (Ireland)", value: "eu-west-1" },
      { label: "EU (Frankfurt)", value: "eu-central-1" },
      { label: "Asia Pacific (Tokyo)", value: "ap-northeast-1" },
      { label: "Asia Pacific (Singapore)", value: "ap-southeast-1" },
    ],
  },
  { name: "accessKeyId", label: "Access Key ID", type: "password", required: true },
  { name: "secretAccessKey", label: "Secret Access Key", type: "password", required: true },
  { name: "ecsClusterArn", label: "ECS Cluster ARN", type: "text", required: false },
];

const gcpCloudRunFields: ProviderConfigField[] = [
  { name: "projectId", label: "GCP Project ID", type: "text", required: true },
  { name: "region", label: "Region", type: "text", required: true, defaultValue: "us-central1" },
  { name: "serviceAccountKey", label: "Service Account Key (JSON)", type: "textarea", required: true },
];

/**
 * Registry of all available provider plugins.
 * The UI uses this to dynamically render the provider setup wizard.
 */
export const providerRegistry: Record<ProviderType, ProviderPluginMeta> = {
  "docker-local": {
    type: "docker-local",
    name: "Local Docker",
    description: "Deploy to the local Docker daemon on this server",
    icon: "docker",
    configSchema: dockerLocalFields,
  },
  "docker-remote": {
    type: "docker-remote",
    name: "Remote Docker Host",
    description: "Deploy to any server with Docker installed via SSH or TLS",
    icon: "server",
    configSchema: dockerRemoteFields,
  },
  proxmox: {
    type: "proxmox",
    name: "Proxmox VE",
    description: "Deploy to Proxmox Virtual Environment (LXC containers or VMs)",
    icon: "proxmox",
    configSchema: proxmoxFields,
  },
  kubernetes: {
    type: "kubernetes",
    name: "Kubernetes",
    description: "Deploy to any Kubernetes cluster (self-hosted or managed)",
    icon: "kubernetes",
    configSchema: kubernetesFields,
  },
  "aws-ecs": {
    type: "aws-ecs",
    name: "AWS (ECS Fargate)",
    description: "Deploy serverless containers on Amazon ECS Fargate",
    icon: "aws",
    configSchema: awsEcsFields,
  },
  "gcp-cloudrun": {
    type: "gcp-cloudrun",
    name: "Google Cloud Run",
    description: "Deploy serverless containers on Google Cloud Run",
    icon: "gcp",
    configSchema: gcpCloudRunFields,
  },
  "azure-aci": {
    type: "azure-aci",
    name: "Azure Container Instances",
    description: "Deploy containers on Azure Container Instances",
    icon: "azure",
    configSchema: [],
  },
  hetzner: {
    type: "hetzner",
    name: "Hetzner Cloud",
    description: "Deploy to Hetzner Cloud servers",
    icon: "hetzner",
    configSchema: [],
  },
  digitalocean: {
    type: "digitalocean",
    name: "DigitalOcean",
    description: "Deploy to DigitalOcean droplets or App Platform",
    icon: "digitalocean",
    configSchema: [],
  },
};

/**
 * Get provider metadata for a specific type
 */
export function getProviderMeta(type: ProviderType): ProviderPluginMeta | undefined {
  return providerRegistry[type];
}

/**
 * Get all available provider types with metadata
 */
export function listAvailableProviders(): ProviderPluginMeta[] {
  return Object.values(providerRegistry);
}

/**
 * Check if a provider type is implemented (has a working backend)
 */
export function isProviderImplemented(type: ProviderType): boolean {
  const implemented: ProviderType[] = ["docker-local", "docker-remote", "proxmox"];
  return implemented.includes(type);
}
