---
sidebar_position: 5
title: Databases API
description: Database provisioning, management, and connection detail endpoints.
---

# Databases API

All endpoints in this section are available through the `database` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/database.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List all databases in the organization.
- **Input:** { projectId?, organizationId }
- **Returns:** Database[]

### `getById`

- **Type:** query
- **Description:** Get a single database with connection details.
- **Input:** { id }
- **Returns:** Database

### `create`

- **Type:** mutation
- **Description:** Provision a new database.
- **Input:** { name, type, projectId, databaseName, username, password, ... }
- **Returns:** Database

### `update`

- **Type:** mutation
- **Description:** Update database configuration.
- **Input:** { id, ...fields }
- **Returns:** Database

### `delete`

- **Type:** mutation
- **Description:** Delete a database and remove its container.
- **Input:** { id }

### `deploy`

- **Type:** mutation
- **Description:** Deploy or restart the database container.
- **Input:** { id }
- **Returns:** Deployment


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
