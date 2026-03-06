---
title: "Plans & Pricing"
sidebar_position: 1
---

# Plans & Pricing

GuildServer offers three billing tiers designed for different team sizes and workloads. Plans are stored in the `plans` table, managed through Stripe, and can be changed at any time from the billing dashboard. New organizations are automatically assigned the Hobby (free) plan.

## Plan Comparison

| Feature | Hobby (Free) | Pro ($29/mo) | Enterprise (Custom) |
|---------|-------------|-------------|-------------------|
| **Monthly price** | $0 | $29/month or $290/year | Custom |
| **Applications** | 3 | 10 | Unlimited |
| **Databases** | 1 | 5 | Unlimited |
| **Deployments/month** | 50 | Unlimited | Unlimited |
| **Build minutes/month** | 100 | 5,000 | Unlimited |
| **Bandwidth** | 10 GB | 100 GB | Unlimited |
| **Max memory per app** | 512 MB | 4 GB | Unlimited |
| **Max CPU per app** | 0.5 cores | 2 cores | Unlimited |
| **Domains per app** | 1 | 10 | Unlimited |
| **Team members** | 1 | 3 | Unlimited |
| **Audit log retention** | 7 days | 30 days | 365 days |

### Feature Availability

| Feature | Hobby | Pro | Enterprise |
|---------|-------|-----|-----------|
| Preview deployments | No | Yes | Yes |
| Team collaboration | No | Yes | Yes |
| Custom domains | No | Yes | Yes |
| Spend management | No | Yes | Yes |
| Webhooks | No | Yes | Yes |
| API access | No | Yes | Yes |
| SSO (SAML/OIDC/LDAP) | No | No | Yes |
| Priority support | No | No | Yes |
| Compliance features | No | No | Yes |

## Plan Details

### Hobby Plan

The Hobby plan is free and designed for personal projects, learning, and experimentation. It has strict resource limits with **hard caps** -- when a limit is reached, the action is blocked until the next billing period or until the user upgrades.

Key characteristics:
- **Hard cap enforcement** -- Deployments, app creation, and database creation are blocked at the limit.
- **No overages** -- You cannot go over the included amounts.
- **Automatic assignment** -- Every new organization starts on the Hobby plan.

### Pro Plan

The Pro plan is designed for professional developers and small teams. It offers significantly higher limits and features like preview deployments, custom domains, and team collaboration.

Key characteristics:
- **Overage billing** -- Usage beyond included limits is allowed and charged at overage rates (see [Usage Tracking](./usage-tracking.md)).
- **Spend management** -- Set a monthly spending cap to control costs (see [Spend Limits](./spend-limits.md)).
- **14-day free trial** -- Each organization can start one Pro trial via the `billing.startTrial` mutation.
- **Annual billing** -- Save by paying $290/year instead of $29/month ($348/year).

### Enterprise Plan

The Enterprise plan is designed for organizations with advanced requirements. Pricing is custom and negotiated directly.

Key characteristics:
- **Unlimited resources** -- No caps on applications, databases, deployments, or team members.
- **SSO support** -- SAML, OIDC, LDAP, Azure AD, Google, and GitHub Enterprise (see [SSO](../auth/sso.md)).
- **Priority support** -- Dedicated support channel.
- **Compliance** -- SOC 2, audit logging with 365-day retention.

## Plan Database Schema

Plans are stored in the `plans` table:

```sql
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug plan_slug NOT NULL UNIQUE,  -- 'hobby' | 'pro' | 'enterprise'
  description TEXT,
  price_monthly INTEGER,            -- cents (0 = free, null = custom)
  price_yearly INTEGER,             -- cents
  stripe_price_id_monthly VARCHAR(255),
  stripe_price_id_yearly VARCHAR(255),
  limits JSONB DEFAULT '{}' NOT NULL,
  features JSONB DEFAULT '{}' NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Limits JSON Structure

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

A value of `-1` means unlimited (Enterprise plan).

### Features JSON Structure

```json
{
  "previewDeployments": false,
  "teamCollaboration": false,
  "customDomains": false,
  "prioritySupport": false,
  "sso": false,
  "spendManagement": false,
  "webhooks": false,
  "apiAccess": false
}
```

## How to Upgrade

### Via Dashboard

1. Navigate to **Dashboard > Billing**.
2. Click **Upgrade** on the desired plan.
3. You are redirected to a Stripe Checkout session.
4. Complete payment.
5. The subscription is activated immediately.

### Via API

```typescript
// Create a Stripe Checkout session
const { url } = await trpc.billing.createCheckoutSession.mutate({
  organizationId: "your-org-id",
  planSlug: "pro",           // "pro" or "enterprise"
  billingInterval: "monthly", // "monthly" or "yearly"
});

// Redirect the user to the Stripe Checkout URL
window.location.href = url;
```

:::info
Only organization **owners** and **admins** can manage billing. Members will see the current plan but cannot make changes.
:::

## How to Downgrade

Downgrades take effect at the **end of the current billing period**. Your Pro/Enterprise features remain available until the period ends, then the plan reverts to Hobby.

```typescript
// Cancel at period end (downgrade to Hobby)
await trpc.billing.cancelSubscription.mutate({
  organizationId: "your-org-id",
  immediate: false, // false = cancel at period end
});
```

If you cancel and change your mind:

```typescript
// Resume a canceled subscription
await trpc.billing.resumeSubscription.mutate({
  organizationId: "your-org-id",
});
```

## Retrieving Plan Information

### Get All Plans (Public)

```typescript
const plans = await trpc.billing.getPlans.query();
// Returns all active plans with limits, features, and pricing
```

### Get Current Plan for an Organization

```typescript
const current = await trpc.billing.getCurrentPlan.query({
  organizationId: "your-org-id",
});
// Returns: { plan: { name, slug, limits, features }, subscription: { status, seats, ... } }
```

## Free Trial

Each organization can start one 14-day Pro trial:

```typescript
const { trialEnd } = await trpc.billing.startTrial.mutate({
  organizationId: "your-org-id",
});
// trialEnd -> Date when the trial expires
```

:::warning
Each organization can only start one trial. Once used, the trial cannot be restarted. After the trial ends, the subscription reverts to Hobby unless the user adds a payment method and converts to a paid subscription.
:::

## Next Steps

- Learn how [usage is tracked](./usage-tracking.md) against plan limits
- Set [spend limits](./spend-limits.md) to control overage costs
- Understand the [Stripe integration](./stripe-integration.md) powering billing
- Review [resource limits](../infrastructure/resource-limits.md) for per-app constraints
