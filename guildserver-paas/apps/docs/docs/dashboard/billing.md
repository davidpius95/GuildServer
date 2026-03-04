---
title: "Billing"
sidebar_position: 9
---

# Billing

The Billing page (`/dashboard/billing`) manages your subscription, usage limits, invoices, payment methods, and spending controls. It integrates with Stripe for payment processing and provides a self-service portal for managing your plan.

## Page Layout

The page consists of:

1. **Header** -- title and description
2. **Tab navigation** -- five tabs with icons: Overview, Plans, Invoices, Payment, and Spend

The tab navigation uses a custom underline-style tab bar (not the standard Radix Tabs component) for a distinctive visual treatment.

## Overview Tab

The Overview tab presents three sections:

### Current Plan Card

Displays your active subscription details:

- **Plan badge** (gray for Hobby, blue for Pro, purple for Enterprise)
- **Price** formatted as monthly rate per seat (e.g., "$20/seat/month") or "Free" for the Hobby plan
- **Renewal / Cancellation date** -- shows when the plan renews or cancels
- **Trial status** -- amber text showing the trial end date if you are in a trial period

**Action buttons** vary by state:

| State | Available Actions |
|---|---|
| Hobby plan | "Upgrade to Pro" button |
| Paid plan (active) | "Manage Billing" (opens Stripe portal), "Cancel Plan" |
| Paid plan (canceling) | "Resume Subscription" |

### Quick Stats Card

Two stat items in a 2-column grid:

- **Seats** -- number of seats on the current plan
- **Status** -- subscription status (e.g., "active", "trialing", "canceled")

### Usage This Period

A full-width card showing five usage meters with progress bars:

| Metric | Icon | Unit |
|---|---|---|
| **Applications** | Rocket | count |
| **Databases** | Database | count |
| **Deployments** | Arrow | count |
| **Bandwidth** | Globe | GB |
| **Build Minutes** | Clock | minutes |

Each meter displays:
- Current usage vs. limit (or "Unlimited" for `-1` limits)
- A color-coded progress bar: blue (normal), amber (80%+ usage), red (100% usage)

## Plans Tab

Displays all available plans in a 3-column grid. Each plan card includes:

**Header:**
- Plan name and description
- Price (Free, monthly rate, or "Custom" for enterprise)
- "Current Plan" badge on the active plan (highlighted with a primary ring border)

**Limits section:**

| Limit | Description |
|---|---|
| Applications | Maximum number of applications |
| Databases | Maximum database instances |
| Deployments/mo | Monthly deployment limit |
| Bandwidth | Maximum bandwidth in GB |
| Build Minutes | Monthly build minutes |
| Memory/App | Maximum memory per application in MB |

**Features section** (below a divider):
- Preview Deployments
- Team Collaboration
- Priority Support
- SSO / SAML
- Webhooks
- API Access

Each feature shows a green checkmark if included or a dimmed checkmark if not.

**Action buttons:**

| Plan | Actions |
|---|---|
| Current plan | Disabled "Current Plan" button |
| Pro (upgrade from Hobby) | "Upgrade to Pro -- $20/mo" button that creates a Stripe Checkout session, plus a "Start 14-Day Free Trial" button |
| Enterprise | "Contact Sales" button |

:::tip
The 14-day free trial of the Pro plan does not require a credit card. Your plan will revert to Hobby at the end of the trial unless you add a payment method.
:::

## Invoices Tab

Displays a table of all invoices for the organization:

| Column | Description |
|---|---|
| **Invoice** | Invoice number in monospace font. |
| **Date** | Creation date formatted as a locale string. |
| **Amount** | Amount due in dollars (converted from cents). |
| **Status** | Color-coded badge: green for paid, blue for open, gray for draft, red for void/uncollectible. |
| **Actions** | "View" link that opens the invoice in Stripe (new tab). |

When no invoices exist, an empty state displays: "No invoices yet. Invoices will appear here once you upgrade to a paid plan."

Invoices are fetched from `billing.getInvoices` with a limit of 20 entries when the Invoices tab is active.

## Payment Tab

Manages payment methods with Stripe integration:

- **"Manage in Stripe" button** -- opens the Stripe Customer Portal for adding/removing payment methods
- **Payment method list** -- each card shows:
  - Card brand (capitalized) and last 4 digits
  - Expiration date (month/year)
  - "Default" badge for the primary payment method

When no payment method is on file, an empty state appears: "No payment method on file. Add one when upgrading to a paid plan."

## Spend Tab

Configures monthly spending limits for overage protection (available on Pro plan and above):

### Hobby Plan

Displays a message explaining that spend management is available on Pro, with an "Upgrade to Pro" button. The Hobby plan has hard limits with no overages.

### Pro / Enterprise Plan

- **Current Limit** -- displays the active spending limit or "No limit (unlimited)"
- **Usage Credit** -- shows the included monthly usage credit
- **Set Monthly Limit** -- input field and "Set" button to configure a dollar amount
- **Remove** button -- clears the spending limit

:::info
You will receive notifications at 50%, 75%, and 100% of your spending limit. These thresholds are displayed as color-coded cards (amber at 50%, orange at 75%, red at 100%) with the corresponding dollar amounts.
:::

## Related Pages

- [Settings](./settings.md) -- manage organization-level configuration
- [Team Management](./team-management.md) -- manage seats and team size
- [Monitoring](./monitoring.md) -- track resource usage that affects billing
