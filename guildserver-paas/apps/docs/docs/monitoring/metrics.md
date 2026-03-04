---
title: "Metrics"
sidebar_position: 1
---

# Metrics

GuildServer collects real-time container metrics from every running application and stores them in PostgreSQL for historical analysis. Metrics are also broadcast over WebSocket for live dashboard updates.

## How Collection Works

The metrics collector runs on a **15-second interval** by default. On each tick it queries the Docker daemon for stats on all managed containers (those labeled with `gs.managed=true`), computes derived values, inserts rows into the `metrics` table, and broadcasts a summary to all connected WebSocket clients.

```
┌──────────────┐   every 15s   ┌───────────────────┐
│  Docker API  │ ◄──────────── │  metrics-collector │
│  (dockerode) │ ──────────►   │  collectAllMetrics │
└──────────────┘               └────────┬──────────┘
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                  ┌──────────┐   ┌───────────┐   ┌───────────┐
                  │ PostgreSQL│   │ WebSocket │   │  Console  │
                  │  metrics  │   │ broadcast │   │   logger  │
                  └──────────┘   └───────────┘   └───────────┘
```

The collection interval is configurable when calling `startMetricsCollection()`:

```typescript
// Default: 15 seconds
startMetricsCollection(15000);

// Custom: 30 seconds
startMetricsCollection(30000);
```

Collection starts automatically during queue initialization in `initializeQueues()` once Docker connectivity is confirmed.

## Collected Metrics

Each collection cycle produces five metric rows per running container:

| Metric Name | Type | Unit | Description |
|---|---|---|---|
| `cpu_percent` | gauge | % | CPU utilization percentage across all cores |
| `memory_usage_mb` | gauge | MB | Actual memory usage (excluding cache) |
| `memory_percent` | gauge | % | Memory usage as a percentage of limit |
| `network_rx_bytes` | counter | bytes | Total network bytes received |
| `network_tx_bytes` | counter | bytes | Total network bytes transmitted |

### CPU Calculation

CPU percentage is derived from the Docker stats stream using the standard delta formula:

```
cpuDelta = current total_usage - previous total_usage
sysDelta = current system_cpu_usage - previous system_cpu_usage
cpuPercent = (cpuDelta / sysDelta) * numCpus * 100
```

### Memory Calculation

Memory usage subtracts the kernel page cache from the raw usage to reflect actual application memory:

```
actualMemory = memory_stats.usage - memory_stats.stats.cache
memoryPercent = actualMemory / memory_stats.limit * 100
```

### Network I/O

Network bytes are summed across all container network interfaces. Since these are cumulative counters, you compute throughput by taking the difference between two data points divided by the time elapsed.

## Storage Schema

All metrics are stored in the `metrics` table:

```sql
CREATE TABLE metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  type        VARCHAR(50)  NOT NULL,  -- 'counter', 'gauge', 'histogram'
  value       DECIMAL      NOT NULL,
  labels      JSONB        DEFAULT '{}',
  timestamp   TIMESTAMP    DEFAULT NOW(),
  application_id   UUID REFERENCES applications(id),
  organization_id  UUID REFERENCES organizations(id)
);
```

The table has composite indexes for efficient time-range queries:

- `(application_id, name, timestamp)` -- per-app metric lookups
- `(organization_id, name, timestamp)` -- org-wide aggregations
- `(timestamp)` -- global retention cleanup

### Labels

The `labels` JSONB column stores contextual metadata. For example, `memory_usage_mb` includes the memory limit for context:

```json
{ "applicationId": "abc-123", "limitMb": "512" }
```

## Querying Metrics

### Per-Application Metrics

Use the `monitoring.getApplicationMetrics` tRPC procedure to fetch metrics for a single application:

```typescript
const metrics = await trpc.monitoring.getApplicationMetrics.query({
  applicationId: "your-app-id",
  timeRange: "24h", // "1h" | "6h" | "24h" | "7d"
});
```

The response includes current live values (from Docker) plus historical data points:

```typescript
{
  cpu: {
    current: 12.5,     // live Docker stat
    average: 8.3,      // average over time range
    max: 45.2,         // peak over time range
    unit: "%",
    data: [            // time series
      { timestamp: "2025-03-01T12:00:00Z", value: 8.1 },
      { timestamp: "2025-03-01T12:00:15Z", value: 9.4 },
      // ...up to 500 data points
    ]
  },
  memory: { current, average, max, unit: "MB", data: [...] },
  network: { rxBytes, txBytes, rxData: [...], txData: [...] }
}
```

### Organization-Wide Metrics

Use `monitoring.getOrganizationMetrics` for aggregated metrics across all applications in an organization:

```typescript
const orgMetrics = await trpc.monitoring.getOrganizationMetrics.query({
  organizationId: "your-org-id",
  timeRange: "24h", // "1h" | "6h" | "24h" | "7d" | "30d"
});
```

This returns:

```typescript
{
  totalApplications: 5,
  runningApplications: 3,
  totalDeployments: 42,
  successfulDeployments: 38,
  resourceUsage: {
    cpu: { current: 35.2, data: [...] },
    memory: { current: 1024, total: 4096, data: [...] }
  }
}
```

### Raw Metric Query

For advanced use cases, the `monitoring.getMetrics` procedure provides direct access to stored metric rows:

```typescript
const raw = await trpc.monitoring.getMetrics.query({
  organizationId: "your-org-id",
  applicationId: "optional-app-id",   // filter to one app
  metricName: "cpu_percent",          // filter by metric name
  timeRange: "7d",
  limit: 1000,
});
```

Available time ranges: `1h`, `6h`, `24h`, `7d`, `30d`.

## Real-Time Updates

When the collector runs, it broadcasts a `metrics_update` event to all connected WebSocket clients:

```json
{
  "type": "metrics_update",
  "timestamp": "2025-03-01T12:00:15.000Z",
  "containers": { "total": 5, "running": 3, "stopped": 1, "errored": 1 },
  "applications": [
    {
      "applicationId": "abc-123",
      "cpu": 12.5,
      "memory": 256,
      "memoryPercent": 50.0,
      "networkRx": 1048576,
      "networkTx": 524288
    }
  ]
}
```

Subscribe to metrics updates in the frontend by connecting to the WebSocket endpoint at `/ws`.

## Data Retention

Old metrics are cleaned up by the `cleanupOldMetrics()` function. The default retention period is **7 days** for raw data points. You can adjust this by changing the `retentionDays` parameter:

```typescript
await cleanupOldMetrics(14); // keep 14 days
```

:::tip
For long-term trend analysis, consider exporting metrics to an external time-series database like Prometheus or InfluxDB before the retention window expires.
:::

## BullMQ Scheduled Collection

In addition to the in-process 15-second timer, a BullMQ cron job runs every 5 minutes as a backup collector:

```typescript
await monitoringQueue.add("collect-metrics", { type: "collect-metrics" }, {
  repeat: { pattern: "*/5 * * * *" },
  removeOnComplete: 100,
  removeOnFail: 50,
});
```

This ensures metrics are still collected even if the primary timer is interrupted.

## Source Files

| File | Purpose |
|---|---|
| `apps/api/src/services/metrics-collector.ts` | Collection logic, interval management, retention |
| `apps/api/src/services/container-manager.ts` | `collectAllMetrics()`, Docker stats aggregation |
| `apps/api/src/services/docker.ts` | `getContainerStats()`, raw Docker API calls |
| `apps/api/src/routers/monitoring.ts` | tRPC query procedures for metrics |
| `packages/database/src/schema/index.ts` | `metrics` table schema definition |
