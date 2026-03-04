---
sidebar_position: 8
title: Domains API
description: Custom domain management and DNS verification endpoints.
---

# Domains API

All endpoints in this section are available through the `domain` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/domain.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List all domains for an application.
- **Input:** { applicationId }
- **Returns:** Domain[]

### `create`

- **Type:** mutation
- **Description:** Add a custom domain to an application.
- **Input:** { applicationId, domain, isPrimary? }
- **Returns:** Domain

### `verify`

- **Type:** mutation
- **Description:** Trigger DNS verification for a domain.
- **Input:** { id }
- **Returns:** Domain

### `delete`

- **Type:** mutation
- **Description:** Remove a domain from an application.
- **Input:** { id }

### `setPrimary`

- **Type:** mutation
- **Description:** Set a domain as the primary domain.
- **Input:** { id }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
