---
sidebar_position: 7
title: Projects API
description: Project management endpoints.
---

# Projects API

All endpoints in this section are available through the `project` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/project.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List all projects in the organization.
- **Input:** { organizationId }
- **Returns:** Project[]

### `getById`

- **Type:** query
- **Description:** Get a single project by ID.
- **Input:** { id }
- **Returns:** Project

### `create`

- **Type:** mutation
- **Description:** Create a new project.
- **Input:** { name, description?, organizationId }
- **Returns:** Project

### `update`

- **Type:** mutation
- **Description:** Update project details.
- **Input:** { id, name?, description? }
- **Returns:** Project

### `delete`

- **Type:** mutation
- **Description:** Delete a project and all its applications and databases.
- **Input:** { id }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
