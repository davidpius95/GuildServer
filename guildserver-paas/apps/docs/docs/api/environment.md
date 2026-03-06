---
sidebar_position: 9
title: Environment API
description: Environment variable management endpoints.
---

# Environment API

All endpoints in this section are available through the `environment` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/environment.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List all environment variables for an application.
- **Input:** { applicationId }
- **Returns:** EnvironmentVariable[]

### `create`

- **Type:** mutation
- **Description:** Create a new environment variable.
- **Input:** { applicationId, key, value, scope, isSecret? }
- **Returns:** EnvironmentVariable

### `update`

- **Type:** mutation
- **Description:** Update an environment variable value or scope.
- **Input:** { id, value?, scope?, isSecret? }
- **Returns:** EnvironmentVariable

### `delete`

- **Type:** mutation
- **Description:** Delete an environment variable.
- **Input:** { id }

### `bulkCreate`

- **Type:** mutation
- **Description:** Create multiple environment variables at once.
- **Input:** { applicationId, variables: Array }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
