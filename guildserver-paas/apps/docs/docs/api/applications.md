---
sidebar_position: 3
title: Applications API
description: Application CRUD, configuration, and deployment trigger endpoints.
---

# Applications API

All endpoints in this section are available through the `application` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/application.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List all applications in the organization, optionally filtered by project.
- **Input:** { projectId?, organizationId }
- **Returns:** Application[]

### `getById`

- **Type:** query
- **Description:** Get a single application by ID with full configuration.
- **Input:** { id }
- **Returns:** Application

### `create`

- **Type:** mutation
- **Description:** Create a new application.
- **Input:** { name, appName, projectId, sourceType, buildType, ... }
- **Returns:** Application

### `update`

- **Type:** mutation
- **Description:** Update application configuration.
- **Input:** { id, ...fields }
- **Returns:** Application

### `delete`

- **Type:** mutation
- **Description:** Delete an application and all associated resources.
- **Input:** { id }

### `deploy`

- **Type:** mutation
- **Description:** Trigger a new deployment for the application.
- **Input:** { id }
- **Returns:** Deployment

### `stop`

- **Type:** mutation
- **Description:** Stop the running container for the application.
- **Input:** { id }

### `restart`

- **Type:** mutation
- **Description:** Restart the application container.
- **Input:** { id }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
