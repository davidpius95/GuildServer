---
sidebar_position: 11
title: Billing API
description: Subscription management, quotes, invoices, receipts, and payment endpoints.
---

# Billing API

All endpoints in this section are available through the `billing` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/billing.<procedure>`

## Procedures

### `getPlans`

- **Type:** query
- **Description:** List all available billing plans.
- **Returns:** Plan[]

### `getCurrentPlan`

- **Type:** query
- **Description:** Get the current plan and subscription for the organization.
- **Input:** `{ organizationId }`
- **Returns:** `{ plan, subscription }`

### `createCheckoutSession`

- **Type:** mutation
- **Description:** Create a Stripe Checkout session for a paid plan.
- **Input:** `{ organizationId, planSlug, billingInterval }`
- **Returns:** `{ url }`

### `cancelSubscription`

- **Type:** mutation
- **Description:** Cancel the current subscription at period end.
- **Input:** `{ organizationId, immediate? }`

### `getInvoices`

- **Type:** query
- **Description:** List invoices for the organization.
- **Input:** `{ organizationId, limit? }`
- **Returns:** Invoice[]

### `listQuotes`

- **Type:** query
- **Description:** List local billing quotes and quote line items for the organization.
- **Input:** `{ organizationId, limit? }`
- **Returns:** Quote[]

### `createQuote`

- **Type:** mutation
- **Description:** Create a local quote with immutable line item snapshots.
- **Input:** `{ organizationId, currency, validUntil?, lineItems, metadata? }`
- **Returns:** Quote

### `acceptQuote`

- **Type:** mutation
- **Description:** Accept a quote and create one local invoice with copied invoice line items.
- **Input:** `{ organizationId, quoteId }`
- **Returns:** Invoice

### `getInvoice`

- **Type:** query
- **Description:** Get one local invoice and its line items.
- **Input:** `{ organizationId, invoiceId }`
- **Returns:** Invoice

### `listReceipts`

- **Type:** query
- **Description:** List receipts issued after successful provider settlement.
- **Input:** `{ organizationId, limit? }`
- **Returns:** Receipt[]

### `getUsage`

- **Type:** query
- **Description:** Get current billing period usage metrics.
- **Input:** `{ organizationId }`
- **Returns:** UsageRecord[]

### `getPaymentMethods`

- **Type:** query
- **Description:** List payment methods for the organization.
- **Input:** `{ organizationId }`
- **Returns:** PaymentMethod[]

### `setSpendLimit`

- **Type:** mutation
- **Description:** Set a monthly spend limit.
- **Input:** `{ organizationId, spendLimitCents }`

### `getPaymentProviders`

- **Type:** query
- **Description:** Return which payment rails are configured. Secret values are never returned.
- **Returns:** `{ stripe, flutterwave, crypto }`

### `createFlutterwaveCharge`

- **Type:** mutation
- **Description:** Start a Flutterwave v4 charge for subscription, instance, or wallet top-up payments.
- **Input:** `{ organizationId, amountCents, currency, purpose, paymentMethod, redirectUrl?, mobileMoney? }`
- **Returns:** Provider next-action payload

### `payInvoiceWithFlutterwave`

- **Type:** mutation
- **Description:** Start a Flutterwave v4 charge for the remaining balance on a local invoice.
- **Input:** `{ organizationId, invoiceId, paymentMethod, redirectUrl?, mobileMoney? }`
- **Returns:** Provider next-action payload


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
