---
sidebar_position: 18
title: GitHub API
description: GitHub repository browsing and OAuth integration endpoints.
---

# GitHub API

All endpoints in this section are available through the `github` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/github.<procedure>`

## Procedures

### `listRepos`

- **Type:** query
- **Description:** List GitHub repositories accessible by the authenticated user.
- **Input:** { page?, perPage? }
- **Returns:** { repositories, totalCount }

### `getRepo`

- **Type:** query
- **Description:** Get details for a specific repository.
- **Input:** { owner, repo }
- **Returns:** Repository

### `listBranches`

- **Type:** query
- **Description:** List branches for a repository.
- **Input:** { owner, repo }
- **Returns:** Branch[]


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
