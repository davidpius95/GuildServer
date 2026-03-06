---
sidebar_position: 14
title: Users API
description: User profile and account management endpoints.
---

# Users API

All endpoints in this section are available through the `user` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/user.<procedure>`

## Procedures

### `getById`

- **Type:** query
- **Description:** Get a user profile by ID.
- **Input:** { id }
- **Returns:** User

### `list`

- **Type:** query
- **Description:** List users in the organization.
- **Input:** { organizationId }
- **Returns:** User[]

### `updateProfile`

- **Type:** mutation
- **Description:** Update user profile fields.
- **Input:** { name?, avatar?, preferences? }
- **Returns:** User


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
