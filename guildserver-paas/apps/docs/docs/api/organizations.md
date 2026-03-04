---
sidebar_position: 6
title: Organizations API
description: Organization CRUD and membership management endpoints.
---

# Organizations API

All endpoints in this section are available through the `organization` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/organization.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List all organizations the authenticated user belongs to.
- **Returns:** Organization[]

### `getById`

- **Type:** query
- **Description:** Get a single organization by ID.
- **Input:** { id }
- **Returns:** Organization

### `create`

- **Type:** mutation
- **Description:** Create a new organization.
- **Input:** { name, slug, description? }
- **Returns:** Organization

### `update`

- **Type:** mutation
- **Description:** Update organization details.
- **Input:** { id, name?, slug?, description?, logo? }
- **Returns:** Organization

### `delete`

- **Type:** mutation
- **Description:** Delete the organization (owner only).
- **Input:** { id }

### `addMember`

- **Type:** mutation
- **Description:** Add a member to the organization.
- **Input:** { organizationId, userId, role }

### `removeMember`

- **Type:** mutation
- **Description:** Remove a member from the organization.
- **Input:** { organizationId, userId }

### `updateMemberRole`

- **Type:** mutation
- **Description:** Change a member role.
- **Input:** { organizationId, userId, role }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
