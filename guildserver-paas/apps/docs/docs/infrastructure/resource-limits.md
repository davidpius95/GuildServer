---
title: "Resource Limits"
sidebar_position: 4
---

# Resource Limits

GuildServer enforces resource limits on applications and databases to ensure fair usage across the platform and prevent any single workload from consuming all available system resources. Limits are tied to your organization's billing plan and are enforced at the Docker container level.

## Application Resource Limits

Each application can be configured with four resource parameters defined on the `applications` table:

| Field | Column | Type | Description | Docker Flag |
|-------|--------|------|-------------|-------------|
| `memoryReservation` | `memory_reservation` | integer (MB) | Soft memory limit -- guaranteed minimum | `--memory-reservation` |
| `memoryLimit` | `memory_limit` | integer (MB) | Hard memory limit -- container killed if exceeded | `--memory` |
| `cpuReservation` | `cpu_reservation` | decimal (cores) | Soft CPU limit -- guaranteed minimum | `--cpu-shares` (calculated) |
| `cpuLimit` | `cpu_limit` | decimal (cores) | Hard CPU limit -- container throttled | `--cpus` |

### How Limits Map to Docker Flags

When GuildServer deploys a container via the `deployContainer` function in `docker.ts`, resource limits are translated to Docker host configuration:

```typescript
// Memory limit: MB to bytes
if (opts.memoryLimit) {
  containerConfig.HostConfig.Memory = opts.memoryLimit * 1024 * 1024;
}

// CPU limit: cores to NanoCPUs (Docker uses nanoseconds of CPU time)
if (opts.cpuLimit) {
  const cpuValue = typeof opts.cpuLimit === "string"
    ? parseFloat(opts.cpuLimit)
    : opts.cpuLimit;
  containerConfig.HostConfig.NanoCpus = Math.floor(cpuValue * 1e9);
}
```

**Concrete mappings:**

| Application Config | Docker Equivalent | Explanation |
|-------------------|-------------------|-------------|
| `memoryLimit: 512` | `Memory: 536870912` | 512 * 1024 * 1024 bytes |
| `memoryLimit: 4096` | `Memory: 4294967296` | 4 GB in bytes |
| `cpuLimit: 0.5` | `NanoCpus: 500000000` | Half a CPU core |
| `cpuLimit: 2` | `NanoCpus: 2000000000` | Two full CPU cores |

### Memory Behavior

- **Reservation** -- Docker guarantees this amount of memory is available to the container. If the host runs low on memory, containers below their reservation are not killed.
- **Limit** -- If the container attempts to use more than the limit, Docker sends an OOM (Out of Memory) kill signal. The container is terminated and restarted per the `unless-stopped` restart policy.

### CPU Behavior

- **Reservation** -- Docker guarantees this proportion of CPU time when CPU is contested.
- **Limit** -- The container is CPU-throttled (not killed) if it attempts to exceed this limit. Requests queue until CPU time is available.

## Database Resource Limits

Managed databases also support resource limits with a simpler two-field configuration on the `databases` table:

| Field | Column | Type | Description |
|-------|--------|------|-------------|
| `memoryLimit` | `memory_limit` | integer (MB) | Hard memory limit for the database container |
| `cpuLimit` | `cpu_limit` | decimal (cores) | Hard CPU limit for the database container |

## Plan-Based Limits

Resource limits are enforced based on your organization's billing plan. Each plan defines maximum allowable resource allocations as a JSON object in the `plans` table.

### Hobby Plan (Free)

| Resource | Limit |
|----------|-------|
| Memory per application | **512 MB** |
| CPU per application | **0.5 cores** |
| Max applications | 3 |
| Max databases | 1 |
| Deployments per month | 50 |
| Build minutes per month | 100 |
| Bandwidth | 10 GB |
| Domains per application | 1 |
| Team members | 1 |
| Audit log retention | 7 days |

### Pro Plan ($29/month or $290/year)

| Resource | Limit |
|----------|-------|
| Memory per application | **4 GB** |
| CPU per application | **2 cores** |
| Max applications | 10 |
| Max databases | 5 |
| Deployments per month | Unlimited |
| Build minutes per month | 5,000 |
| Bandwidth | 100 GB |
| Domains per application | 10 |
| Team members | 3 |
| Audit log retention | 30 days |

### Enterprise Plan (Custom Pricing)

| Resource | Limit |
|----------|-------|
| All resources | **Unlimited** (`-1` in limits JSON) |
| SSO | Included |
| Priority support | Included |
| Compliance features | Included |
| Audit log retention | 365 days |

### Limits JSON Structure

Plan limits are stored as a JSONB column named `limits` on the `plans` table:

```json
{
  "maxApps": 3,
  "maxDatabases": 1,
  "maxDeployments": 50,
  "maxBandwidthGb": 10,
  "maxBuildMinutes": 100,
  "maxMemoryMb": 512,
  "maxCpuCores": 0.5,
  "maxDomainsPerApp": 1,
  "maxTeamMembers": 1,
  "auditRetentionDays": 7
}
```

A value of `-1` means unlimited (used for Enterprise plans). The default Hobby limits are also hardcoded as a fallback in the `usage-meter.ts` service:

```typescript
// Default to hobby limits if no plan found
return {
  limits: {
    maxApps: 3,
    maxDatabases: 1,
    maxDeployments: 50,
    maxBandwidthGb: 10,
    maxBuildMinutes: 100,
    maxMemoryMb: 512,
    maxCpuCores: 0.5,
    maxDomainsPerApp: 1,
    maxTeamMembers: 1,
  },
  features: {},
  planSlug: "hobby",
};
```

## How Enforcement Works

### Hobby Plan -- Hard Caps

On the Hobby plan, limits are strictly enforced. When a limit is reached, the action is blocked and a `FORBIDDEN` error is returned:

```typescript
if (planSlug === "hobby") {
  const friendlyMetric = metric.replace(/_/g, " ");
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `You've reached the ${friendlyMetric} limit on the Hobby plan (${result.current}/${result.limit}). Upgrade to Pro for higher limits.`,
  });
}
```

### Pro/Enterprise Plans -- Overage Billing

On the Pro and Enterprise plans, usage beyond included limits is allowed but tracked for overage billing through Stripe metered billing. The `enforcePlanLimit()` function allows the action to proceed, and the spend management system handles cost tracking.

### Feature Gating

Some features are restricted to specific plans. The `enforceFeature()` function checks the plan's feature flags:

```typescript
await enforceFeature(orgId, "previewDeployments");
await enforceFeature(orgId, "teamCollaboration");
```

Features stored as boolean flags in the plan's `features` JSON:

```json
{
  "previewDeployments": true,
  "teamCollaboration": true,
  "customDomains": true,
  "prioritySupport": true,
  "sso": false,
  "spendManagement": true,
  "webhooks": true,
  "apiAccess": true
}
```

If a feature is not available on the current plan, a `FORBIDDEN` error is thrown with an upgrade prompt.

## Monitoring Resource Usage

GuildServer provides real-time container stats through the `getContainerStats` function:

```typescript
const stats = await getContainerStats(applicationId);
// Returns:
// {
//   cpuPercent: 12.5,
//   memoryUsageMb: 234.5,
//   memoryLimitMb: 512,
//   memoryPercent: 45.8,
//   networkRxBytes: 1048576,
//   networkTxBytes: 524288,
// }
```

The memory calculation excludes cache memory to provide accurate "actual" memory usage:

```typescript
const actualMemory = memoryUsage - cacheMemory;
```

## Best Practices

:::tip Always Set a Memory Limit
Always set a `memoryLimit` to prevent memory leaks from consuming all host resources. Without a limit, a single container with a memory leak can bring down the entire server.
:::

:::tip Start Low, Scale Up
Start with conservative CPU limits and increase only if you observe CPU throttling in your container stats. Most web applications rarely need more than 1 CPU core.
:::

:::warning OOM Kills
If a container exceeds its `memoryLimit`, Docker kills it immediately. Monitor your application's memory usage and set limits with sufficient headroom (e.g., if your app typically uses 300 MB, set the limit to 512 MB).
:::

### Recommended Defaults by Application Type

| Application Type | Memory | CPU |
|-----------------|--------|-----|
| Static site (nginx) | 128 MB | 0.25 cores |
| Node.js API | 256-512 MB | 0.5 cores |
| Next.js / Nuxt app | 512 MB - 1 GB | 0.5-1 core |
| PostgreSQL database | 512 MB - 2 GB | 0.5-1 core |
| Redis cache | 128-256 MB | 0.25 cores |
| Background worker | 256 MB | 0.25 cores |

## Next Steps

- Learn about [networking](./networking.md) between containers
- Understand [usage tracking](../billing/usage-tracking.md) for metered resources
- Configure [spend limits](../billing/spend-limits.md) to control overage costs
- Review [plans and pricing](../billing/plans.md) for all plan details
