---
title: "Stripe Integration"
sidebar_position: 4
---

# Stripe Integration

GuildServer uses **Stripe** for all payment processing, subscription management, and invoice generation. The integration is implemented in `apps/api/src/services/stripe.ts` (service layer) and `apps/api/src/routes/stripe-webhooks.ts` (webhook handler). Stripe is optional -- if not configured, the platform operates without billing enforcement.

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes (for billing) | Stripe API secret key (starts with `sk_`) |
| `STRIPE_PUBLISHABLE_KEY` | For frontend | Stripe publishable key for client-side Stripe.js |
| `STRIPE_WEBHOOK_SECRET` | Recommended | Webhook signing secret for signature verification |

:::tip
If `STRIPE_SECRET_KEY` is not set, the Stripe client is initialized as `null` and all billing operations gracefully return errors. The platform continues to function without payment processing.
:::

## Architecture Overview

GuildServer mirrors Stripe data locally for fast queries and offline resilience:

| GuildServer Table | Stripe Object | Sync Direction | Purpose |
|------------------|---------------|----------------|---------|
| `plans` | Products + Prices | Manual (seeded) | Billing plan definitions and pricing |
| `subscriptions` | Subscriptions | Webhook -> DB | Active subscription state per org |
| `invoices` | Invoices | Webhook -> DB | Invoice history and payment status |
| `payment_methods` | Payment Methods | Webhook -> DB | Stored card details (last 4, brand, expiry) |
| `usage_records` | Usage Records | DB -> Stripe | Metered usage reported to Stripe |

### Data Flow

```
Plan Changes:     Dashboard -> API -> Stripe Checkout -> Stripe -> Webhook -> API -> DB
Invoice Events:   Stripe -> Webhook -> API -> DB
Payment Methods:  Stripe Portal -> Stripe -> Webhook -> API -> DB
Usage Reporting:  API -> DB (local) and API -> Stripe (metered billing)
```

## Checkout Sessions

When a user upgrades to a paid plan, GuildServer creates a Stripe Checkout session that handles the entire payment flow.

### Creating a Checkout Session

```typescript
export async function createCheckoutSession(
  organizationId: string,
  planSlug: "pro" | "enterprise",
  billingInterval: "monthly" | "yearly",
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const customerId = await getOrCreateCustomerId(organizationId);

  const plan = await db.query.plans.findFirst({
    where: eq(plans.slug, planSlug),
  });

  const priceId = billingInterval === "yearly"
    ? plan.stripePriceIdYearly
    : plan.stripePriceIdMonthly;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { organizationId, planSlug },
    subscription_data: {
      metadata: { organizationId, planSlug },
    },
  });

  return session.url;
}
```

### Checkout Flow

```
1. User clicks "Upgrade to Pro" in the dashboard
2. API calls billing.createCheckoutSession mutation
3. API creates or retrieves Stripe customer for the organization
4. API creates a Stripe Checkout session with the plan's price
5. API returns the Checkout URL
6. Frontend redirects user to Stripe Checkout
7. User enters payment details on Stripe's hosted page
8. On success, Stripe redirects to {FRONTEND_URL}/dashboard/billing?success=true
9. Stripe fires customer.subscription.created webhook
10. API syncs the subscription to the local database
```

## Customer Portal

GuildServer integrates with Stripe's Customer Portal for self-service billing management. The portal allows users to:

- Update payment methods
- View and download invoices
- Cancel or modify subscriptions
- Update billing information

```typescript
export async function createPortalSession(
  organizationId: string,
  returnUrl: string
): Promise<string> {
  const customerId = await getOrCreateCustomerId(organizationId);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}
```

### Portal Access via API

```typescript
const { url } = await trpc.billing.createPortalSession.mutate({
  organizationId: "your-org-id",
});
// Redirect user to url
```

## Subscription Lifecycle

Subscriptions go through several states tracked both in Stripe and locally:

| Status | Description | Stripe Equivalent |
|--------|-------------|-------------------|
| `active` | Subscription is current and paid | `active` |
| `trialing` | Free trial period (14 days for Pro) | `trialing` |
| `past_due` | Payment failed, grace period active | `past_due`, `unpaid` |
| `canceled` | Subscription has been canceled | `canceled`, `incomplete_expired` |
| `paused` | Subscription temporarily paused | `paused` |
| `incomplete` | Initial payment not yet completed | `incomplete` |

### Cancellation

Subscriptions can be canceled in two ways:

```typescript
// Cancel at period end (user keeps access until period expires)
await cancelSubscription(organizationId, false);

// Cancel immediately (access revoked now)
await cancelSubscription(organizationId, true);
```

On immediate cancellation, the local subscription status is set to `canceled`. On period-end cancellation, `cancelAtPeriodEnd` is set to `true` and the current status is preserved.

### Subscription Deletion (Downgrade to Hobby)

When a Stripe subscription is fully deleted (via the `customer.subscription.deleted` webhook), GuildServer automatically downgrades the organization to the Hobby plan:

```typescript
export async function handleSubscriptionDeleted(
  stripeSubscription: Stripe.Subscription
): Promise<void> {
  const hobbyPlan = await db.query.plans.findFirst({
    where: eq(plans.slug, "hobby"),
  });

  // Reset subscription to Hobby
  await db.update(subscriptions).set({
    planId: hobbyPlan.id,
    status: "active",
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    trialStart: null,
    trialEnd: null,
  });
}
```

## Webhook Events

GuildServer handles Stripe webhook events at the `/webhooks/stripe` endpoint. The webhook handler uses raw body parsing (configured before the JSON middleware) for signature verification.

### Handled Events

| Event | Handler Action |
|-------|----------------|
| `checkout.session.completed` | Log checkout completion (subscription sync happens via subscription events) |
| `customer.subscription.created` | Sync new subscription to local DB |
| `customer.subscription.updated` | Update subscription status, period, and plan |
| `customer.subscription.deleted` | Downgrade organization to Hobby plan |
| `customer.subscription.trial_will_end` | Send trial ending notification to org owner |
| `invoice.created` | Create local invoice record; reset spend notifications for new period |
| `invoice.paid` | Mark invoice as paid |
| `invoice.payment_failed` | Send payment failure notification to org owner |
| `payment_method.attached` | Save payment method details (brand, last4, expiry) |
| `payment_method.detached` | Remove payment method from local DB |

### Webhook Security

```typescript
if (webhookSecret) {
  const signature = req.headers["stripe-signature"];
  event = stripe.webhooks.constructEvent(
    req.body,     // raw body (not JSON-parsed)
    signature,
    webhookSecret
  );
} else {
  // Dev mode: no signature verification
  event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}
```

:::danger
Always set `STRIPE_WEBHOOK_SECRET` in production. Without it, anyone can send fake webhook events to your endpoint. The signing secret is available in your Stripe Dashboard under Webhooks.
:::

### Webhook Resilience

The handler always returns `200 OK` to Stripe, even if processing fails. This prevents Stripe from retrying and causing duplicate processing. Errors are logged for debugging:

```typescript
// Always return 200 to acknowledge receipt
res.status(200).json({ received: true });
```

## Subscription Syncing

The `syncSubscriptionFromStripe` function maps Stripe subscription data to the local database:

```typescript
export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription
): Promise<void> {
  const organizationId = stripeSubscription.metadata?.organizationId;
  const planSlug = stripeSubscription.metadata?.planSlug;

  const subData = {
    stripeCustomerId: stripeSubscription.customer as string,
    stripeSubscriptionId: stripeSubscription.id,
    status: mapStripeStatus(stripeSubscription.status),
    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    trialStart: stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : null,
    trialEnd: stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : null,
  };

  // Upsert: update if exists, insert if new
  if (existingSub) {
    await db.update(subscriptions).set(subData).where(...);
  } else {
    await db.insert(subscriptions).values({ organizationId, planId, ...subData });
  }
}
```

### Status Mapping

Stripe statuses are mapped to GuildServer's subscription status enum:

| Stripe Status | GuildServer Status |
|---------------|-------------------|
| `active` | `active` |
| `trialing` | `trialing` |
| `past_due` | `past_due` |
| `canceled` | `canceled` |
| `unpaid` | `past_due` |
| `incomplete` | `incomplete` |
| `incomplete_expired` | `canceled` |
| `paused` | `paused` |

## Invoice Syncing

Invoices from Stripe are mirrored to the local `invoices` table:

```typescript
const invoiceData = {
  organizationId: org.id,
  stripeInvoiceId: stripeInvoice.id,
  number: stripeInvoice.number,
  status: mapInvoiceStatus(stripeInvoice.status),
  amountDueCents: stripeInvoice.amount_due,
  amountPaidCents: stripeInvoice.amount_paid,
  currency: stripeInvoice.currency,
  periodStart: new Date(stripeInvoice.period_start * 1000),
  periodEnd: new Date(stripeInvoice.period_end * 1000),
  invoiceUrl: stripeInvoice.hosted_invoice_url,
  pdfUrl: stripeInvoice.invoice_pdf,
  paidAt: stripeInvoice.status === "paid" ? new Date() : null,
};
```

### Viewing Invoices

```typescript
const invoices = await trpc.billing.getInvoices.query({
  organizationId: "your-org-id",
  limit: 20,
});
// Returns: [{ id, number, status, amountDueCents, invoiceUrl, pdfUrl, ... }]
```

## Payment Methods

Payment method details are synced from Stripe via webhooks:

```typescript
// On payment_method.attached
await db.insert(paymentMethods).values({
  organizationId: org.id,
  stripePaymentMethodId: pm.id,
  type: "card",
  cardBrand: card.brand,    // "visa", "mastercard", etc.
  cardLast4: card.last4,    // "4242"
  cardExpMonth: card.exp_month,
  cardExpYear: card.exp_year,
  isDefault: false,
});

// On payment_method.detached
await db.delete(paymentMethods)
  .where(eq(paymentMethods.stripePaymentMethodId, pm.id));
```

### Viewing Payment Methods

```typescript
const methods = await trpc.billing.getPaymentMethods.query({
  organizationId: "your-org-id",
});
// Returns: [{ id, type, cardBrand, cardLast4, cardExpMonth, cardExpYear, isDefault }]
```

## Usage Reporting to Stripe

For metered billing on Pro plans, usage is reported to Stripe:

```typescript
export async function reportUsageToStripe(
  organizationId: string,
  meteredPriceId: string,
  quantity: number
): Promise<void> {
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const meteredItem = stripeSub.items.data.find(
    (item) => item.price.id === meteredPriceId
  );

  if (meteredItem) {
    await stripe.subscriptionItems.createUsageRecord(meteredItem.id, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: "increment",
    });
  }
}
```

## Setting Up Stripe

### 1. Create Stripe Account

Sign up at [stripe.com](https://stripe.com) and get your API keys from the Dashboard.

### 2. Configure Environment Variables

```env
STRIPE_SECRET_KEY=sk_live_your_secret_key
STRIPE_PUBLISHABLE_KEY=pk_live_your_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

### 3. Create Products and Prices

Create products and prices in Stripe that match your plan configuration, then add the Stripe Price IDs to the `plans` table:

```sql
UPDATE plans SET
  stripe_price_id_monthly = 'price_monthly_id',
  stripe_price_id_yearly = 'price_yearly_id'
WHERE slug = 'pro';
```

### 4. Configure Webhook Endpoint

In the Stripe Dashboard:
1. Go to **Developers > Webhooks**.
2. Add an endpoint: `https://your-domain.com/webhooks/stripe`.
3. Select the events listed in the "Handled Events" section above.
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.

## Next Steps

- Review [plans and pricing](./plans.md) for plan configuration
- Understand [usage tracking](./usage-tracking.md) for metered billing
- Configure [spend limits](./spend-limits.md) for cost control
- Set up [authentication](../auth/authentication.md) for API access
