---
title: "Health Checks"
sidebar_position: 2
---

# Health Checks

GuildServer continuously monitors the health of deployed containers and infrastructure services. Health checks detect crashed containers, sync database state, and provide system-wide health status through the API.

## Automated Container Health Checks

A BullMQ cron job runs health checks every **2 minutes**:

```typescript
await monitoringQueue.add("health-check", { type: "health-check" }, {
  repeat: { pattern: "*/2 * * * *" },
  removeOnComplete: 50,
  removeOnFail: 20,
});
```

Each health check cycle calls `syncContainerStatuses()`, which polls the Docker daemon for all GuildServer-managed containers and updates the application status in the database.

## What Gets Checked

### Container State Sync

The `syncContainerStatuses()` function queries Docker for all containers with the `gs.managed=true` and `gs.type=application` labels and maps their Docker state to an application status:

| Docker State | Application Status |
|---|---|
| `running` | `running` |
| `exited` | `stopped` |
| `dead` | `stopped` |
| `paused` | `paused` |
| `restarting` | `restarting` |
| `created` | `deploying` |
| (other) | `unknown` |

This runs automatically, so if a container crashes (exits unexpectedly), the application status in the database is updated to `stopped` within two minutes.

### Per-Application Health Check

The `healthCheck()` function inspects a specific container to determine:

- **Whether it is running** -- queries Docker inspect API for `State.Running`
- **Container status** -- the raw Docker status string (e.g., `running`, `exited`, `dead`)
- **Uptime in seconds** -- calculated from `State.StartedAt`

```typescript
const result = await healthCheck(applicationId);
// {
//   healthy: true,
//   status: "running",
//   uptime: 86400  // seconds
// }
```

If no container exists for the application, the function returns:

```typescript
{ healthy: false, status: "not_found" }
```

If the Docker API call fails, it returns:

```typescript
{ healthy: false, status: "error" }
```

### Container Summary

The `getContainerSummary()` function provides a quick overview of all managed containers:

```typescript
const summary = await getContainerSummary();
// {
//   total: 5,
//   running: 3,
//   stopped: 1,
//   errored: 1
// }
```

## System Health API

The `monitoring.getSystemHealth` tRPC procedure provides a comprehensive system health report combining infrastructure checks with per-application health:

```typescript
const health = await trpc.monitoring.getSystemHealth.query({
  organizationId: "your-org-id",
});
```

### Response Structure

```typescript
{
  overall: "healthy" | "warning" | "critical",
  services: [
    {
      name: "Docker Engine",
      status: "healthy",    // or "critical" if Docker is down
      uptime: "Available",
      responseTime: "<1ms",
    },
    {
      name: "API Server",
      status: "healthy",
      uptime: "Running",
      responseTime: "<5ms",
    },
    {
      name: "WebSocket",
      status: "healthy",
      uptime: "3 client(s)",
      responseTime: "<1ms",
    },
    {
      name: "Containers",
      status: "healthy",    // or "warning" if any errored
      uptime: "3/5 running",
      responseTime: "N/A",
    },
  ],
  applications: [
    {
      applicationId: "abc-123",
      name: "My App",
      appName: "my-app",
      healthy: true,
      status: "running",
      uptime: 86400,
    },
  ],
  containers: { total: 5, running: 3, stopped: 1, errored: 1 },
  alerts: [],
}
```

### Overall Health Logic

The `overall` field is determined by the following rules:

| Condition | Overall Status |
|---|---|
| Docker Engine is down | `critical` |
| Any application container is unhealthy | `warning` |
| Any container is in errored state | `warning` |
| Everything is running normally | `healthy` |

:::warning
Health checks run with **bounded concurrency** (maximum 3 parallel Docker API calls) to avoid overloading the Docker daemon when many applications are deployed.
:::

## Alerts Generation

The `monitoring.getAlerts` procedure generates real-time alerts based on health check results and resource metrics:

```typescript
const alerts = await trpc.monitoring.getAlerts.query({
  organizationId: "your-org-id",
  severity: "critical", // optional filter: "critical" | "warning" | "info"
  limit: 50,
});
```

Alerts are computed on-the-fly (not stored) from current container state:

| Alert | Severity | Trigger |
|---|---|---|
| Container Unhealthy | `critical` | App status is `running` but container is not healthy |
| Deployment Failed | `warning` | Application status is `failed` |
| High CPU Usage | `warning` | CPU utilization exceeds 80% |
| High Memory Usage | `warning` | Memory utilization exceeds 85% |
| Docker Engine Unavailable | `critical` | Docker daemon not responding |

## Applications Summary

The `monitoring.getApplicationsSummary` procedure combines health checks and live stats for all applications in an organization:

```typescript
const summary = await trpc.monitoring.getApplicationsSummary.query({
  organizationId: "your-org-id",
});
```

Returns an array of objects per application:

```typescript
[
  {
    id: "abc-123",
    name: "My App",
    appName: "my-app",
    status: "running",
    healthy: true,
    uptime: 86400,
    cpu: 12.5,
    memory: 256,
    memoryPercent: 50.0,
    networkRx: 1048576,
    networkTx: 524288,
  },
]
```

## API Server Health Endpoint

The GuildServer API exposes a `GET /health` endpoint for external monitoring tools:

```bash
curl http://localhost:4000/health
```

This returns an HTTP 200 response when the API server is operational. Use this endpoint for:

- Load balancer health checks
- External uptime monitoring services (e.g., UptimeRobot, Pingdom)
- Kubernetes liveness/readiness probes
- Docker Compose `healthcheck` directives

## Initial Sync on Startup

When the API server starts, an initial container status sync runs immediately after Docker connectivity is confirmed:

```typescript
if (dockerOk) {
  await syncContainerStatuses();
  logger.info("Initial container status sync completed");
}
```

This ensures the database reflects actual container state even after an API server restart.

## Source Files

| File | Purpose |
|---|---|
| `apps/api/src/services/container-manager.ts` | `syncContainerStatuses()`, `healthCheck()`, `getContainerSummary()` |
| `apps/api/src/queues/setup.ts` | BullMQ cron job configuration |
| `apps/api/src/routers/monitoring.ts` | `getSystemHealth`, `getAlerts`, `getApplicationsSummary` |
| `apps/api/src/services/docker.ts` | `testDockerConnection()`, `listManagedContainers()` |
