---
sidebar_position: 2
title: Auth API
description: Authentication endpoints for login, registration, and token management.
---

# Auth API

All endpoints in this section are available through the `auth` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/auth.<procedure>`

## Procedures

### `login`

- **Type:** mutation
- **Description:** Authenticate with email and password, returns a JWT token.
- **Input:** { email, password }
- **Returns:** { token, user }

### `register`

- **Type:** mutation
- **Description:** Create a new user account.
- **Input:** { email, password, name }
- **Returns:** { token, user }

### `me`

- **Type:** query
- **Description:** Get the currently authenticated user profile.
- **Returns:** { id, email, name, role, ... }

### `updateProfile`

- **Type:** mutation
- **Description:** Update the authenticated user profile.
- **Input:** { name?, avatar? }
- **Returns:** { user }

### `changePassword`

- **Type:** mutation
- **Description:** Change the authenticated user password.
- **Input:** { currentPassword, newPassword }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
