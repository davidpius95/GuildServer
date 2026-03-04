---
sidebar_position: 15
title: Kubernetes API
description: Kubernetes cluster and deployment management endpoints.
---

# Kubernetes API

All endpoints in this section are available through the `kubernetes` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/kubernetes.<procedure>`

## Procedures

### `listClusters`

- **Type:** query
- **Description:** List registered Kubernetes clusters.
- **Input:** { organizationId }
- **Returns:** KubernetesCluster[]

### `registerCluster`

- **Type:** mutation
- **Description:** Register a new Kubernetes cluster.
- **Input:** { name, kubeconfig, endpoint, organizationId, ... }
- **Returns:** KubernetesCluster

### `removeCluster`

- **Type:** mutation
- **Description:** Remove a registered cluster.
- **Input:** { id }

### `listDeployments`

- **Type:** query
- **Description:** List K8s deployments.
- **Input:** { clusterId? }
- **Returns:** K8sDeployment[]

### `deploy`

- **Type:** mutation
- **Description:** Create a K8s deployment for an application.
- **Input:** { applicationId, clusterId, namespace?, helmChartName?, values? }
- **Returns:** K8sDeployment

### `scale`

- **Type:** mutation
- **Description:** Scale a K8s deployment.
- **Input:** { id, replicas }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
