---
title: "Kubernetes Integration"
sidebar_position: 3
---

# Kubernetes Integration

GuildServer supports deploying applications to external Kubernetes clusters alongside the default Docker-based deployment model. This enables teams to leverage existing K8s infrastructure for production workloads while using GuildServer for orchestration, monitoring, and management.

## Overview

The Kubernetes integration allows you to:

- **Register external clusters** with their kubeconfig, endpoint, and provider metadata
- **Deploy applications** to specific clusters and namespaces
- **Install Helm charts** for infrastructure components
- **Monitor cluster health** with metrics, node status, and pod counts
- **Scale deployments** by adjusting replica counts

:::info
The Kubernetes integration is designed for teams that already operate K8s clusters. GuildServer does not provision or manage the clusters themselves -- it deploys applications to them.
:::

## Registering a Cluster

To deploy to a Kubernetes cluster, you first register it with GuildServer by providing its connection details.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` (min 1 char) | Human-readable cluster name |
| `kubeconfig` | `string` (min 1 char) | Full kubeconfig YAML for authentication |
| `endpoint` | `string` (URL) | Kubernetes API server endpoint |
| `organizationId` | `UUID` | The organization that owns this cluster |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Kubernetes version (e.g., `v1.29.0`) |
| `provider` | `string` | Cloud provider identifier |
| `region` | `string` | Deployment region (e.g., `us-east-1`) |

### tRPC API Example

```typescript
// Register a new cluster
const cluster = await trpc.kubernetes.createCluster.mutate({
  name: "production-us-east",
  kubeconfig: "<your-kubeconfig-yaml>",
  endpoint: "https://k8s-api.example.com:6443",
  organizationId: "your-org-uuid",
  provider: "aws",
  region: "us-east-1",
});

// Returns the new cluster record with id, status: "pending", etc.
```

:::warning
Only organization **owners** and **admins** can register, update, or delete clusters. The kubeconfig is stored securely and never returned in API responses -- it is always masked as `***` when retrieved via `getClusterById`.
:::

### Cluster Status Lifecycle

After registration, a cluster starts in `pending` status. The defined statuses are:

| Status | Description |
|--------|-------------|
| `active` | Connected and healthy |
| `inactive` | Registered but not currently reachable |
| `pending` | Awaiting initial validation |
| `error` | Connection or authentication failure |
| `maintenance` | Temporarily offline for planned maintenance |

## Supported Providers

GuildServer supports clusters from any Kubernetes-conformant provider:

| Provider | Identifier | Notes |
|----------|-----------|-------|
| **AWS EKS** | `aws` | Amazon Elastic Kubernetes Service |
| **GCP GKE** | `gcp` | Google Kubernetes Engine |
| **Azure AKS** | `azure` | Azure Kubernetes Service |
| **Self-managed** | `self-managed` | kubeadm, k3s, k0s, RKE, or any conformant cluster |

The provider field is informational and used for organizing clusters in the dashboard. It does not affect deployment behavior.

## Deploying to a Cluster

Once a cluster is registered, you can deploy applications to it using the `deployToCluster` mutation.

### Deployment Input Schema

```typescript
const deployToK8sSchema = z.object({
  clusterId: z.string().uuid(),
  applicationId: z.string().uuid(),
  namespace: z.string().default("default"),
  helmChartName: z.string().optional(),
  helmChartVersion: z.string().optional(),
  values: z.record(z.any()).default({}),
});
```

### Deploy Example

```typescript
const deployment = await trpc.kubernetes.deployToCluster.mutate({
  clusterId: "cluster-uuid",
  applicationId: "app-uuid",
  namespace: "production",
  helmChartName: "my-app-chart",
  helmChartVersion: "1.2.0",
  values: {
    replicas: 3,
    image: { tag: "v2.1.0" },
    resources: {
      requests: { cpu: "250m", memory: "256Mi" },
      limits: { cpu: "500m", memory: "512Mi" },
    },
  },
});
```

### Deployment Naming Convention

K8s deployments are automatically named using the pattern `app-{first 8 chars of applicationId}`. For example, an application with ID `a1b2c3d4-e5f6-...` creates a deployment named `app-a1b2c3d4`.

## K8s Deployment Tracking

Each Kubernetes deployment is tracked in the `k8s_deployments` database table:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique deployment record ID |
| `name` | varchar(255) | Deployment name in the cluster |
| `namespace` | varchar(255) | Kubernetes namespace (default: `default`) |
| `clusterId` | UUID | Foreign key to `kubernetes_clusters` |
| `applicationId` | UUID | Foreign key to `applications` |
| `helmChartName` | varchar(255) | Helm chart used (if any) |
| `helmChartVersion` | varchar(50) | Helm chart version |
| `values` | JSONB | Configuration values passed to Helm or K8s |
| `status` | varchar(50) | Current deployment status |
| `replicas` | integer | Desired replica count (default: 1) |
| `readyReplicas` | integer | Currently ready replicas (default: 0) |

### Deployment Statuses

| Status | Description |
|--------|-------------|
| `pending` | Deployment submitted, waiting to start |
| `running` | All replicas healthy and serving traffic |
| `failed` | Deployment encountered an error |
| `stopped` | Manually stopped |

## Listing Deployments

Retrieve all deployments for a specific cluster:

```typescript
const deployments = await trpc.kubernetes.listDeployments.query({
  clusterId: "cluster-uuid",
});

// Each deployment includes the linked application info:
// { id, name, namespace, status, replicas, readyReplicas,
//   application: { id, name, appName } }
```

## Helm Chart Support

GuildServer supports deploying applications via Helm charts. The Kubernetes service layer provides methods for installing and managing Helm releases.

### Installing a Chart

```typescript
const release = await kubernetesService.installHelmChart("cluster-id", {
  name: "nginx-ingress",
  chart: "ingress-nginx/ingress-nginx",
  version: "4.7.1",
  namespace: "ingress-nginx",
  values: {
    controller: { replicaCount: 2 },
  },
});
```

### Helm Release Statuses

| Status | Description |
|--------|-------------|
| `deployed` | Successfully installed and running |
| `pending` | Installation in progress |
| `failed` | Installation or upgrade failed |
| `uninstalled` | Release has been removed |

## Scaling Deployments

You can scale K8s deployments by adjusting the replica count through the service layer:

```typescript
const scaled = await kubernetesService.scaleDeployment(
  "cluster-id",
  "deployment-id",
  5 // new replica count
);
```

## Cluster Metrics and Status

### Cluster Status API

Get detailed status information about a registered cluster:

```typescript
const status = await trpc.kubernetes.getClusterStatus.query({
  id: "cluster-uuid",
});
// Returns:
// {
//   status: "active",
//   nodes: [{ name, status, cpu, memory }, ...],
//   namespaces: [{ name, status }, ...],
//   version: "v1.29.0"
// }
```

### Cluster Metrics API

Retrieve CPU, memory, and pod metrics with 24-hour history:

```typescript
const metrics = await trpc.kubernetes.getClusterMetrics.query({
  id: "cluster-uuid",
});
// Returns:
// {
//   cpuUsage: { current, total, data: [{timestamp, value}, ...] },
//   memoryUsage: { current, total, data: [{timestamp, value}, ...] },
//   podCount: { running, pending, failed, total }
// }
```

## Access Control

Kubernetes operations follow organization-based access control:

| Operation | Required Role |
|-----------|--------------|
| List clusters | Any member |
| View cluster details | Any member |
| Get cluster status/metrics | Any member |
| Create cluster | Owner or Admin |
| Update cluster | Owner or Admin |
| Delete cluster | Owner or Admin |
| Deploy to cluster | Any member |
| List deployments | Any member |

## Database Schema

### `kubernetes_clusters` Table

```sql
CREATE TABLE kubernetes_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  kubeconfig TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  version VARCHAR(50),
  provider VARCHAR(100),
  region VARCHAR(100),
  status cluster_status DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### `k8s_deployments` Table

```sql
CREATE TABLE k8s_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  namespace VARCHAR(255) DEFAULT 'default',
  cluster_id UUID REFERENCES kubernetes_clusters(id) ON DELETE CASCADE,
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  helm_chart_name VARCHAR(255),
  helm_chart_version VARCHAR(50),
  values JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',
  replicas INTEGER DEFAULT 1,
  ready_replicas INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Next Steps

- Configure [resource limits](./resource-limits.md) for K8s and Docker deployments
- Understand the [networking model](./networking.md) for Docker-based deployments
- Review [roles and permissions](../auth/roles-permissions.md) for access control
