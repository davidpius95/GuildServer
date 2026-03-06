---
sidebar_position: 17
title: Audit API
description: Audit log query endpoints for compliance and security monitoring.
---

# Audit API

All endpoints in this section are available through the `audit` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/audit.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List audit log entries for the organization.
- **Input:** { organizationId, action?, resourceType?, userId?, startDate?, endDate?, limit?, offset? }
- **Returns:** AuditLog[]

### `getById`

- **Type:** query
- **Description:** Get a single audit log entry with full metadata.
- **Input:** { id }
- **Returns:** AuditLog


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
