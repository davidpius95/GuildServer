---
sidebar_position: 12
title: Monitoring API
description: Application metrics and health check endpoints.
---

# Monitoring API

All endpoints in this section are available through the `monitoring` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/monitoring.<procedure>`

## Procedures

### `getMetrics`

- **Type:** query
- **Description:** Get metrics for an application over a time range.
- **Input:** { applicationId, metricName, startTime, endTime }
- **Returns:** Metric[]

### `getHealthStatus`

- **Type:** query
- **Description:** Get the current health status of an application.
- **Input:** { applicationId }
- **Returns:** { status, checks }

### `recordMetric`

- **Type:** mutation
- **Description:** Record a new metric data point.
- **Input:** { applicationId, name, type, value, labels? }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
