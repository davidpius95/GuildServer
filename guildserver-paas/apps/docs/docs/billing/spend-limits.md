---
title: "Spend Limits"
sidebar_position: 3
---

# Spend Limits

Spend limits allow organization owners to set a hard cap on monthly overage costs, preventing unexpected charges from runaway deployments or traffic spikes. This is a Pro+ plan feature implemented in `apps/api/src/services/spend-manager.ts`.

:::info
Spend limits only apply to **Pro** and **Enterprise** plans. The Hobby plan has hard caps that block actions at the limit -- there are no overages and thus no spend limit needed.
:::

## What Spend Limits Are

A spend limit is a **monthly dollar cap** on overage charges. Overages occur when your usage exceeds the amounts included in your plan. The spend limit prevents your overage bill from exceeding a specified amount.

The limit is stored on the `subscriptions` table as `spendLimitCents`:

```sql
spend_limit_cents INTEGER  -- nullable: null = unlimited
```

- **`null`** -- No limit configured. Overages are billed without restriction.
- **`0`** -- No overages allowed. Effectively makes Pro limits act like hard caps.
- **Positive value** -- Maximum overage spend in cents (e.g., `5000` = $50.00).

## Overage Rates

When usage exceeds plan limits, overages are charged at these rates:

| Metric | Rate | Unit |
|--------|------|------|
| Bandwidth | $0.15 | per GB |
| Build minutes | $0.01 | per minute |
| Deployments | $0.10 | per deployment |

These rates are defined in the spend manager service:

```typescript
const OVERAGE_RATES = {
  bandwidth_gb: 15,   // $0.15 per GB (15 cents)
  build_minutes: 1,   // $0.01 per minute (1 cent)
  deployments: 10,    // $0.10 per deployment (10 cents)
};
```

## How Spend Limits Work

### Overage Calculation

The `calculateOverageCost` function computes current overage costs:

```typescript
const { totalCents, breakdown } = await calculateOverageCost(organizationId);
// Returns:
// {
//   totalCents: 450,
//   breakdown: {
//     bandwidth_gb: { overage: 5, costCents: 75, rate: 15 },
//     build_minutes: { overage: 200, costCents: 200, rate: 1 },
//     deployments: { overage: 10, costCents: 100, rate: 10 },
//   }
// }
```

The calculation:
1. Fetches the organization's plan limits.
2. Fetches current usage for the billing period.
3. For each metered metric, calculates `overage = max(0, current - limit)`.
4. Multiplies overage by the rate to get cost in cents.
5. Sums all metric costs into `totalCents`.

:::tip
Usage credits (`usageCreditCents` on the subscription) are subtracted from the total spend before comparing against the limit. This means credits effectively raise your spend ceiling.
:::

### Spend Limit Check

Before allowing actions that generate overage costs, the `checkSpendLimit` function validates the current spend against the limit:

```typescript
const result = await checkSpendLimit(organizationId);
// Returns:
// {
//   allowed: true,
//   currentSpendCents: 350,
//   limitCents: 5000,
//   percentage: 7,
//   reason?: "Spend limit reached ($50.00/$50.00)..."
// }
```

When the spend limit is reached (`allowed: false`), new overage-generating actions are blocked with a message explaining the situation and suggesting options.

## Threshold Alerts

The spend manager sends notifications when spending reaches predefined thresholds. Three thresholds are monitored:

| Threshold | When Triggered | Notification Event |
|-----------|---------------|-------------------|
| **50%** | Spend reaches half the limit | `spend_threshold_50` |
| **75%** | Spend reaches three-quarters | `spend_threshold_75` |
| **100%** | Spend reaches the full limit | `spend_threshold_100` |

The `checkSpendThresholds` function is called after each metered usage event:

```typescript
export async function checkSpendThresholds(organizationId: string): Promise<void> {
  // ... calculate current spend percentage ...

  const thresholds = [
    { pct: 50, event: "spend_threshold_50" },
    { pct: 75, event: "spend_threshold_75" },
    { pct: 100, event: "spend_threshold_100" },
  ];

  for (const threshold of thresholds) {
    if (percentage >= threshold.pct && !notified[`${threshold.pct}`]) {
      await notify(threshold.event, owner.userId, organizationId, {
        currentSpend,
        spendLimit,
        percentage: threshold.pct,
        url: `${process.env.APP_URL}/dashboard/billing`,
      });
      notified[`${threshold.pct}`] = true;
    }
  }
}
```

### Notification Deduplication

To prevent sending the same alert multiple times during a billing period, the spend manager tracks which thresholds have been notified using the subscription's `metadata` JSONB field:

```json
{
  "spendNotified": {
    "50": true,
    "75": true,
    "100": false
  }
}
```

These flags are **reset at the start of each new billing period** via the `resetSpendNotifications` function, which is called from the Stripe webhook handler when a new invoice is created.

## Setting and Modifying Spend Limits

### Via the Dashboard

1. Navigate to **Dashboard > Billing**.
2. Click **Set Spend Limit** (or **Edit Spend Limit** if already set).
3. Enter the maximum monthly amount in dollars.
4. Click **Save**.

### Via the API

```typescript
// Set a $50 monthly spend limit
await trpc.billing.setSpendLimit.mutate({
  organizationId: "your-org-id",
  spendLimitCents: 5000, // $50.00
});

// Remove the spend limit (unlimited overages)
await trpc.billing.setSpendLimit.mutate({
  organizationId: "your-org-id",
  spendLimitCents: null,
});
```

:::warning
Only organization **owners** and **admins** can set spend limits.
:::

### Checking Spend Status

```typescript
const status = await trpc.billing.getSpendStatus.query({
  organizationId: "your-org-id",
});
// Returns:
// {
//   currentSpendCents: 2500,
//   limitCents: 5000,
//   percentage: 50,
//   allowed: true,
//   overage: {
//     totalCents: 2500,
//     breakdown: { ... }
//   }
// }
```

## Behavior When Limit Is Reached

When the spend limit is reached (`checkSpendLimit` returns `allowed: false`):

1. **New deployments** that would generate overage costs may be blocked.
2. **Existing running applications** are **not affected** -- they continue to run.
3. **The 100% threshold notification** is sent to the organization owner.
4. **Error message** includes the current spend and limit: `"Spend limit reached ($50.00/$50.00). Increase your spend limit or wait for the next billing period."`

### How to Unblock

1. **Increase the spend limit** -- Takes effect immediately.
2. **Wait for the next billing period** -- Usage resets and spend notifications are cleared.
3. **Remove the spend limit** -- Set to `null` for unlimited overages.

## Spend Limit Lifecycle

```
1. Organization owner sets spendLimitCents = $50 (5000 cents)
2. Usage accumulates during the billing period
3. At 50% ($25 spent): notification sent to owner
4. At 75% ($37.50 spent): notification sent to owner
5. At 100% ($50 spent): notification sent, new overage-generating actions blocked
6. New billing period starts (Stripe webhook: invoice.created)
7. Spend notifications are reset
8. Usage tracking starts fresh
9. Cycle repeats
```

## Next Steps

- Review [usage tracking](./usage-tracking.md) to understand what generates overage costs
- Compare [plans](./plans.md) to see included amounts per tier
- Learn about the [Stripe integration](./stripe-integration.md) for billing infrastructure
- Understand [resource limits](../infrastructure/resource-limits.md) for per-container constraints
