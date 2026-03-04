---
sidebar_position: 10
title: Webhooks API
description: Webhook delivery tracking and management endpoints.
---

# Webhooks API

All endpoints in this section are available through the `webhook` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/webhook.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List webhook deliveries for an application.
- **Input:** { applicationId?, limit?, offset? }
- **Returns:** WebhookDelivery[]

### `getById`

- **Type:** query
- **Description:** Get a single webhook delivery with full payload.
- **Input:** { id }
- **Returns:** WebhookDelivery

### `retry`

- **Type:** mutation
- **Description:** Retry a failed webhook delivery.
- **Input:** { id }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
