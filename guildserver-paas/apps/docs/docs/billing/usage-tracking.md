---
title: "Usage Tracking"
sidebar_position: 2
---

# Usage Tracking

GuildServer tracks metered usage for each organization to enforce plan limits, display usage dashboards, and report consumption to Stripe for overage billing. The usage metering system is implemented in `apps/api/src/services/usage-meter.ts`.

## Tracked Metrics

| Metric | Key | Unit | Description |
|--------|-----|------|-------------|
| Deployments | `deployments` | count | Number of deployments triggered in the billing period |
| Build minutes | `build_minutes` | minutes | Total build time consumed |
| Bandwidth | `bandwidth_gb` | GB | Data transfer in and out |
| Storage | `storage_gb` | GB | Artifact and database storage consumed |
| Applications | `applications` | count | Total number of applications (counted from DB, not usage records) |
| Databases | `databases` | count | Total number of databases (counted from DB, not usage records) |

## How Tracking Works

### Usage Records Table

Metered usage is stored in the `usage_records` table:

```sql
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric VARCHAR(100) NOT NULL,
  value DECIMAL DEFAULT '0' NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  reported_to_stripe BOOLEAN DEFAULT false,
  stripe_usage_record_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
```

Indexes:
- `usage_records_org_metric_idx` on `(organization_id, metric)` -- for fast lookups
- `usage_records_period_idx` on `(period_start, period_end)` -- for period-based queries

### Incrementing Usage

When a metered event occurs, the API calls a tracking function. The `incrementUsage` helper either updates an existing record for the current period or creates a new one:

```typescript
// Track a deployment
export async function trackDeployment(organizationId: string): Promise<void> {
  await incrementUsage(organizationId, "deployments", 1);
}

// Track build minutes
export async function trackBuildMinutes(
  organizationId: string,
  minutes: number
): Promise<void> {
  await incrementUsage(organizationId, "build_minutes", minutes);
}

// Track bandwidth
export async function trackBandwidth(
  organizationId: string,
  gigabytes: number
): Promise<void> {
  await incrementUsage(organizationId, "bandwidth_gb", gigabytes);
}
```

The `incrementUsage` function uses SQL to atomically increment the value:

```typescript
async function incrementUsage(
  organizationId: string,
  metric: string,
  value: number
): Promise<void> {
  const { periodStart, periodEnd } = await getCurrentPeriod(organizationId);

  const existing = await db.query.usageRecords.findFirst({
    where: and(
      eq(usageRecords.organizationId, organizationId),
      eq(usageRecords.metric, metric),
      eq(usageRecords.periodStart, periodStart),
      eq(usageRecords.periodEnd, periodEnd)
    ),
  });

  if (existing) {
    // Atomic increment
    await db.update(usageRecords)
      .set({ value: sql`${usageRecords.value} + ${value}` })
      .where(eq(usageRecords.id, existing.id));
  } else {
    // Create new record for this period
    await db.insert(usageRecords).values({
      organizationId,
      metric,
      value: String(value),
      periodStart,
      periodEnd,
    });
  }
}
```

### Billing Periods

Usage is scoped to billing periods. The period is determined from the organization's subscription:

```typescript
async function getCurrentPeriod(organizationId: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (sub?.currentPeriodStart && sub?.currentPeriodEnd) {
    return {
      periodStart: new Date(sub.currentPeriodStart),
      periodEnd: new Date(sub.currentPeriodEnd),
    };
  }

  // Default to calendar month if no subscription
  const now = new Date();
  return {
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  };
}
```

## Checking Limits

The `checkLimit` function determines whether a specific metric is within plan limits:

```typescript
const result = await checkLimit(organizationId, "deployments");
// Returns:
// {
//   allowed: true,       // whether the action is allowed
//   current: 45,         // current usage count
//   limit: 50,           // plan limit
//   overage: 0,          // how much over the limit
//   isUnlimited: false   // true for Enterprise (-1 limits)
// }
```

### Metric to Limit Key Mapping

Usage metric names are mapped to plan limit keys:

| Usage Metric | Plan Limit Key |
|-------------|---------------|
| `deployments` | `maxDeployments` |
| `bandwidth_gb` | `maxBandwidthGb` |
| `build_minutes` | `maxBuildMinutes` |
| `applications` | `maxApps` |
| `databases` | `maxDatabases` |
| `storage_gb` | `maxStorageGb` |

### Resource-Based vs. Metered Metrics

The system handles two types of metrics differently:

- **Resource-based** (`applications`, `databases`) -- Counted by querying actual database rows. These represent the current state, not accumulated usage.
- **Metered** (`deployments`, `build_minutes`, `bandwidth_gb`) -- Tracked via `usage_records`. These accumulate over the billing period.

```typescript
if (metric === "applications") {
  // Count actual rows in the applications table
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(applications)
    .where(eq(applications.projectId, /* org's project */));
  current = result[0]?.count || 0;
} else {
  // Sum usage records for the current period
  const usage = await getCurrentUsage(organizationId);
  current = usage[metric] || 0;
}
```

## Usage Enforcement

### Hobby Plan -- Hard Caps

On the Hobby plan, limits are strictly enforced. When a limit is reached, the action is blocked:

```typescript
if (planSlug === "hobby") {
  throw new Error(
    `Plan limit reached: ${metric}. You've used ${current}/${limit}. Upgrade to Pro for higher limits.`
  );
}
```

The `enforcePlanLimit()` function in `trpc.ts` wraps this logic and throws a `FORBIDDEN` tRPC error:

```typescript
// Used in routers before creating resources
await enforcePlanLimit(orgId, "applications");
await enforcePlanLimit(orgId, "deployments");
```

### Pro/Enterprise Plans -- Overage Billing

On Pro and Enterprise plans, usage beyond included limits is allowed. Overages are tracked and billed through Stripe metered billing. The [spend management system](./spend-limits.md) can optionally impose hard caps.

## Usage Dashboard API

The billing router provides a `getUsage` endpoint that returns formatted usage data:

```typescript
const usage = await trpc.billing.getUsage.query({
  organizationId: "your-org-id",
});

// Returns:
// {
//   metrics: {
//     deployments: { current: 42, limit: 50, unit: "deployments" },
//     bandwidth_gb: { current: 3.2, limit: 10, unit: "GB" },
//     build_minutes: { current: 67, limit: 100, unit: "minutes" },
//     applications: { current: 2, limit: 3, unit: "apps" },
//     databases: { current: 1, limit: 1, unit: "databases" },
//   },
//   periodStart: "2024-01-01T00:00:00.000Z",
//   periodEnd: "2024-01-31T23:59:59.999Z",
// }
```

### Usage Summary (Internal)

The `getUsageSummary` function provides a dashboard-friendly format with percentages:

```typescript
const summary = await getUsageSummary(organizationId);
// Returns:
// {
//   metrics: {
//     deployments: { current: 42, limit: 50, percentage: 84, isUnlimited: false },
//     applications: { current: 2, limit: 3, percentage: 67, isUnlimited: false },
//     ...
//   },
//   planSlug: "hobby"
// }
```

## Default Hobby Limits

When no plan is found for an organization, the system falls back to these hardcoded Hobby defaults:

```typescript
{
  maxApps: 3,
  maxDatabases: 1,
  maxDeployments: 50,
  maxBandwidthGb: 10,
  maxBuildMinutes: 100,
  maxMemoryMb: 512,
  maxCpuCores: 0.5,
  maxDomainsPerApp: 1,
  maxTeamMembers: 1,
}
```

## Stripe Usage Reporting

For Pro plans, accumulated usage is reported to Stripe via the `reportUsageToStripe` function, which creates usage records on metered subscription items. The `reported_to_stripe` flag on usage records prevents duplicate reporting.

## Next Steps

- Set [spend limits](./spend-limits.md) to cap monthly overage costs
- Review [plans and pricing](./plans.md) for limit details
- Understand the [Stripe integration](./stripe-integration.md) for metered billing
- Configure [resource limits](../infrastructure/resource-limits.md) per application
