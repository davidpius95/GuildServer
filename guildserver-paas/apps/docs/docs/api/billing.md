---
sidebar_position: 11
title: Billing API
description: Subscription management, invoices, and payment method endpoints.
---

# Billing API

All endpoints in this section are available through the `billing` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/billing.<procedure>`

## Procedures

### `getSubscription`

- **Type:** query
- **Description:** Get the current subscription for the organization.
- **Input:** { organizationId }
- **Returns:** Subscription

### `getPlans`

- **Type:** query
- **Description:** List all available billing plans.
- **Returns:** Plan[]

### `subscribe`

- **Type:** mutation
- **Description:** Subscribe the organization to a plan.
- **Input:** { organizationId, planId, billingPeriod }

### `cancelSubscription`

- **Type:** mutation
- **Description:** Cancel the current subscription at period end.
- **Input:** { organizationId }

### `getInvoices`

- **Type:** query
- **Description:** List invoices for the organization.
- **Input:** { organizationId, limit? }
- **Returns:** Invoice[]

### `getUsage`

- **Type:** query
- **Description:** Get current billing period usage metrics.
- **Input:** { organizationId }
- **Returns:** UsageRecord[]

### `getPaymentMethods`

- **Type:** query
- **Description:** List payment methods for the organization.
- **Input:** { organizationId }
- **Returns:** PaymentMethod[]

### `setSpendLimit`

- **Type:** mutation
- **Description:** Set a monthly spend limit.
- **Input:** { organizationId, limitCents }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
