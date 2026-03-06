---
sidebar_position: 4
title: Deployments API
description: Deployment management, history, and rollback endpoints.
---

# Deployments API

All endpoints in this section are available through the `deployment` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/deployment.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List deployments for an application or across the organization.
- **Input:** { applicationId?, organizationId?, status?, limit? }
- **Returns:** Deployment[]

### `getById`

- **Type:** query
- **Description:** Get a single deployment with full logs.
- **Input:** { id }
- **Returns:** Deployment

### `create`

- **Type:** mutation
- **Description:** Create and trigger a new deployment.
- **Input:** { applicationId, title?, description? }
- **Returns:** Deployment

### `cancel`

- **Type:** mutation
- **Description:** Cancel a pending or building deployment.
- **Input:** { id }

### `rollback`

- **Type:** mutation
- **Description:** Roll back to a previous deployment by reusing its image.
- **Input:** { applicationId, deploymentId }
- **Returns:** Deployment


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
