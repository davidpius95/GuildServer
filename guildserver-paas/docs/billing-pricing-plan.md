# GuildServer Business Model, Pricing & Billing System (Vercel-Style)

## Context

**Problem**: GuildServer has no monetization layer. Users can deploy unlimited apps/databases with no billing, usage tracking, or plan enforcement. There's no way to charge customers or gate features by tier.

**Goal**: Build a complete billing system modeled after Vercel — 3 pricing tiers (Free/Pro/Enterprise), per-seat pricing + usage-based metering, Stripe payment integration, spend management, and feature gating. This turns GuildServer from an open tool into a revenue-generating SaaS platform.

**Current state**: No billing code exists. However, the codebase has strong foundations — multi-tenant organizations, member roles (owner/admin/member), resource limits on apps/databases, audit logging, and a tRPC middleware pattern ready for billing guards.

---

## Business Model Design (Adapted from Vercel)

### Pricing Tiers

| | **Hobby (Free)** | **Pro ($20/seat/month)** | **Enterprise (Custom)** |
|---|---|---|---|
| **Target** | Personal projects, non-commercial | Teams, startups, commercial use | Large orgs, compliance needs |
| **Seats** | 1 developer | Unlimited ($20/each) + free viewers | Custom |
| **Applications** | 3 | 25 | Unlimited |
| **Databases** | 1 | 10 | Unlimited |
| **Deployments** | 50/month | 500/month | Unlimited |
| **Bandwidth** | 10 GB/month | 100 GB/month (+$0.15/GB) | Custom |
| **Build Minutes** | 100 min/month | 1,000 min/month (+$0.01/min) | Custom |
| **Memory per App** | 512 MB max | 4 GB max | 16 GB max |
| **CPU per App** | 0.5 cores max | 2 cores max | 8 cores max |
| **Custom Domains** | 1 per app | Unlimited | Unlimited |
| **Preview Deployments** | No | Yes | Yes |
| **Team Collaboration** | No | Yes | Yes |
| **Priority Support** | No | Email | Dedicated + SLA |
| **SSO/SAML** | No | Add-on ($50/mo) | Included |
| **Audit Logs** | 7 days | 90 days | 1 year |
| **Spend Management** | Hard cap (no overages) | Yes (configurable) | Yes |
| **Usage Credit** | — | $10/month included | Custom |

### Revenue Streams
1. **Per-seat subscription** — $20/seat/month (Pro), predictable recurring revenue
2. **Usage-based overages** — bandwidth, build minutes, deployments beyond included amounts
3. **Add-ons** — SSO ($50/mo), extra storage, premium support
4. **Enterprise contracts** — Annual, custom pricing, starting ~$500/month

---

## Phase 1: Database Schema — Billing Tables

**File**: `packages/database/src/schema/index.ts`

### New Enums
```
planSlugEnum: "hobby" | "pro" | "enterprise"
subscriptionStatusEnum: "active" | "trialing" | "past_due" | "canceled" | "paused" | "incomplete"
invoiceStatusEnum: "draft" | "open" | "paid" | "void" | "uncollectible"
```

### New Table: `plans`
Defines the available pricing tiers (seeded, not user-created):
```
- id: UUID (PK)
- name: VARCHAR ("Hobby", "Pro", "Enterprise")
- slug: planSlugEnum
- description: TEXT
- priceMonthly: INTEGER (cents — 0, 2000, custom)
- priceYearly: INTEGER (cents — 0, 20000, custom)
- stripePriceIdMonthly: VARCHAR (Stripe price ID)
- stripePriceIdYearly: VARCHAR (Stripe price ID)
- limits: JSONB — { maxApps, maxDatabases, maxDeployments, maxBandwidthGb, maxBuildMinutes, maxMemoryMb, maxCpuCores, maxDomainsPerApp, maxTeamMembers, auditRetentionDays }
- features: JSONB — { previewDeployments, teamCollaboration, customDomains, prioritySupport, sso, spendManagement, webhooks, apiAccess }
- sortOrder: INTEGER
- isActive: BOOLEAN (default true)
- createdAt, updatedAt
```

### New Table: `subscriptions`
Links an organization to a plan:
```
- id: UUID (PK)
- organizationId: UUID (FK → organizations, unique — one subscription per org)
- planId: UUID (FK → plans)
- status: subscriptionStatusEnum
- stripeCustomerId: VARCHAR
- stripeSubscriptionId: VARCHAR
- currentPeriodStart: TIMESTAMP
- currentPeriodEnd: TIMESTAMP
- cancelAtPeriodEnd: BOOLEAN (default false)
- trialStart: TIMESTAMP
- trialEnd: TIMESTAMP
- seats: INTEGER (default 1)
- usageCreditCents: INTEGER (monthly credit in cents, e.g. 1000 = $10)
- spendLimitCents: INTEGER (nullable — null means unlimited for enterprise)
- metadata: JSONB
- createdAt, updatedAt
```

### New Table: `invoices`
Mirrors Stripe invoices locally for fast queries:
```
- id: UUID (PK)
- organizationId: UUID (FK → organizations)
- subscriptionId: UUID (FK → subscriptions)
- stripeInvoiceId: VARCHAR
- number: VARCHAR (invoice number like "GS-2026-0001")
- status: invoiceStatusEnum
- amountDueCents: INTEGER
- amountPaidCents: INTEGER
- currency: VARCHAR (default "usd")
- periodStart: TIMESTAMP
- periodEnd: TIMESTAMP
- invoiceUrl: TEXT (Stripe hosted invoice URL)
- pdfUrl: TEXT (Stripe PDF URL)
- paidAt: TIMESTAMP
- createdAt: TIMESTAMP
```

### New Table: `usageRecords`
Tracks metered usage per org per billing period:
```
- id: UUID (PK)
- organizationId: UUID (FK → organizations)
- metric: VARCHAR — "deployments" | "bandwidth_gb" | "build_minutes" | "storage_gb"
- value: DECIMAL
- periodStart: DATE
- periodEnd: DATE
- reportedToStripe: BOOLEAN (default false)
- stripeUsageRecordId: VARCHAR
- createdAt: TIMESTAMP
```

### New Table: `paymentMethods`
Cached payment method info (card details from Stripe):
```
- id: UUID (PK)
- organizationId: UUID (FK → organizations)
- stripePaymentMethodId: VARCHAR
- type: VARCHAR ("card")
- cardBrand: VARCHAR ("visa", "mastercard", etc.)
- cardLast4: VARCHAR(4)
- cardExpMonth: INTEGER
- cardExpYear: INTEGER
- isDefault: BOOLEAN
- createdAt: TIMESTAMP
```

### Columns added to existing tables

**`organizations`** — add:
- `stripeCustomerId: VARCHAR` (nullable)

**`members`** — add role option:
- Update `memberRoleEnum` to include `"billing"` role (can manage billing but not deploy)

### Relations
- `organizations` → `subscriptions` (one-to-one)
- `organizations` → `invoices` (one-to-many)
- `organizations` → `usageRecords` (one-to-many)
- `organizations` → `paymentMethods` (one-to-many)
- `subscriptions` → `plans` (many-to-one)

Run `pnpm --filter @guildserver/database db:push` to sync.

---

## Phase 2: Stripe Integration Service

**New file**: `apps/api/src/services/stripe.ts`

Install Stripe SDK: `pnpm --filter @guildserver/api add stripe`

### Core Functions

| Function | Purpose |
|----------|---------|
| `createCustomer(org)` | Create Stripe customer for org, save `stripeCustomerId` |
| `createSubscription(orgId, planSlug, paymentMethodId)` | Create Stripe subscription, save locally |
| `cancelSubscription(orgId, atPeriodEnd?)` | Cancel or schedule cancellation |
| `changeSubscription(orgId, newPlanSlug)` | Upgrade/downgrade (proration) |
| `createCheckoutSession(orgId, planSlug)` | Stripe Checkout for new subscriptions |
| `createPortalSession(orgId)` | Stripe Customer Portal for self-service billing |
| `reportUsage(orgId, metric, quantity)` | Report metered usage to Stripe |
| `getUpcomingInvoice(orgId)` | Preview next invoice with overages |
| `listInvoices(orgId)` | List past invoices |
| `syncSubscriptionFromStripe(stripeSubscription)` | Sync Stripe webhook data to DB |
| `createSetupIntent(orgId)` | For adding payment methods |
| `getPaymentMethods(orgId)` | List saved cards |

### Stripe Product Setup
Create in Stripe Dashboard (or via seed script):
- **Product**: "GuildServer Pro"
  - Price: $20/seat/month (recurring, per_unit)
  - Price: $200/seat/year (recurring, per_unit — annual discount)
- **Metered prices** (usage_type: metered):
  - Bandwidth overage: $0.15/GB
  - Build minutes overage: $0.01/minute
  - Extra deployments: $0.10/deployment
- **Product**: "GuildServer Add-ons"
  - SSO: $50/month (flat)

---

## Phase 3: Stripe Webhook Handler

**New file**: `apps/api/src/routes/stripe-webhooks.ts`

Express route mounted at `POST /webhooks/stripe`. Verifies Stripe signature, processes events:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create subscription, activate plan |
| `customer.subscription.created` | Sync subscription to DB |
| `customer.subscription.updated` | Update plan/status in DB |
| `customer.subscription.deleted` | Mark subscription canceled, downgrade to Hobby |
| `invoice.created` | Create local invoice record |
| `invoice.paid` | Update invoice status, clear past_due |
| `invoice.payment_failed` | Mark subscription past_due, notify user |
| `payment_method.attached` | Save payment method locally |
| `payment_method.detached` | Remove from local DB |
| `customer.subscription.trial_will_end` | Notify user 3 days before trial ends |

**Mount in**: `apps/api/src/index.ts` — add `app.use("/webhooks/stripe", stripeWebhookRouter)` with raw body parser (before json middleware).

---

## Phase 4: Usage Metering Service

**New file**: `apps/api/src/services/usage-meter.ts`

Tracks and enforces usage limits in real-time.

### Functions

| Function | Purpose |
|----------|---------|
| `trackDeployment(orgId)` | Increment deployment count for current period |
| `trackBandwidth(orgId, bytes)` | Track bandwidth consumption |
| `trackBuildMinutes(orgId, minutes)` | Track build time |
| `getCurrentUsage(orgId)` | Get all usage metrics for current period |
| `checkLimit(orgId, metric)` | Check if org is within plan limits (returns `{ allowed, current, limit, overage }`) |
| `enforceLimit(orgId, metric)` | Throw error if limit exceeded (for hard-capped Hobby plan) |
| `getUsageSummary(orgId)` | Dashboard-friendly summary with percentages |

### Integration Points
- **`setup.ts` deployment worker**: Call `trackDeployment()` on every deploy, `trackBuildMinutes()` after build completes
- **`docker.ts`**: Track bandwidth through container network stats
- **Monitoring worker**: Periodically sync usage to Stripe for metered billing

### Spend Management (Pro plan)
- Check `subscription.spendLimitCents` against accumulated overage costs
- At 50%, 75%, 100% thresholds → send notifications via existing notification system
- At 100% with hard cap enabled → pause deployments (return 403 with message)
- Org owner can adjust spend limit or resume paused projects

---

## Phase 5: Plan Enforcement Middleware

**File**: `apps/api/src/trpc/trpc.ts`

### New Middleware: `planGuard`

Add to tRPC context:
```typescript
// Enrich context with subscription info
context.subscription = { plan, status, limits, features, usage }
```

### New Procedures

| Procedure Type | Purpose |
|----------------|---------|
| `subscribedProcedure` | Requires active subscription (Pro+) |
| `featureGuard(featureName)` | Checks if feature is enabled for org's plan |
| `limitGuard(metric)` | Checks usage is within plan limits |

### Enforcement Examples
- **Creating 4th app on Hobby**: `limitGuard("maxApps")` blocks with "Upgrade to Pro for more applications"
- **Preview deployment on Hobby**: `featureGuard("previewDeployments")` blocks with "Preview deployments require Pro plan"
- **Adding team member on Hobby**: `featureGuard("teamCollaboration")` blocks with upgrade prompt
- **51st deployment on Hobby (hard cap)**: `limitGuard("maxDeployments")` hard-blocks

---

## Phase 6: tRPC Billing Router

**New file**: `apps/api/src/routers/billing.ts`

| Procedure | Auth | Purpose |
|-----------|------|---------|
| `billing.getPlans` | public | List all available plans with pricing |
| `billing.getCurrentPlan` | protected | Get org's current subscription + usage summary |
| `billing.getUsage` | protected | Detailed usage breakdown for current period |
| `billing.createCheckoutSession` | protected (owner/billing) | Start Stripe Checkout for upgrade |
| `billing.createPortalSession` | protected (owner/billing) | Open Stripe Customer Portal |
| `billing.changePlan` | protected (owner/billing) | Upgrade/downgrade |
| `billing.cancelSubscription` | protected (owner) | Cancel at period end |
| `billing.resumeSubscription` | protected (owner) | Resume canceled subscription |
| `billing.getInvoices` | protected (owner/billing) | List past invoices |
| `billing.getUpcomingInvoice` | protected (owner/billing) | Preview next invoice |
| `billing.getPaymentMethods` | protected (owner/billing) | List saved cards |
| `billing.setSpendLimit` | protected (owner/billing) | Set spend management limit |
| `billing.getSpendStatus` | protected | Current spend vs limit |
| `billing.startTrial` | protected (owner) | Start 14-day Pro trial (once per org) |

**Register in**: `apps/api/src/trpc/router.ts` — add `billing: billingRouter`

---

## Phase 7: Seed Plans Data

**New file**: `packages/database/src/seed-plans.ts`

Seed script that creates the 3 plans in the `plans` table with their limits and feature flags. Run once on setup, idempotent.

```typescript
const plans = [
  {
    name: "Hobby",
    slug: "hobby",
    priceMonthly: 0,
    limits: { maxApps: 3, maxDatabases: 1, maxDeployments: 50, maxBandwidthGb: 10, maxBuildMinutes: 100, maxMemoryMb: 512, maxCpuCores: 0.5, maxDomainsPerApp: 1, maxTeamMembers: 1, auditRetentionDays: 7 },
    features: { previewDeployments: false, teamCollaboration: false, customDomains: true, prioritySupport: false, sso: false, spendManagement: false, webhooks: false, apiAccess: false },
  },
  {
    name: "Pro",
    slug: "pro",
    priceMonthly: 2000, // $20.00 in cents
    limits: { maxApps: 25, maxDatabases: 10, maxDeployments: 500, maxBandwidthGb: 100, maxBuildMinutes: 1000, maxMemoryMb: 4096, maxCpuCores: 2, maxDomainsPerApp: 50, maxTeamMembers: -1, auditRetentionDays: 90 },
    features: { previewDeployments: true, teamCollaboration: true, customDomains: true, prioritySupport: true, sso: false, spendManagement: true, webhooks: true, apiAccess: true },
  },
  {
    name: "Enterprise",
    slug: "enterprise",
    priceMonthly: null, // custom
    limits: { maxApps: -1, maxDatabases: -1, maxDeployments: -1, maxBandwidthGb: -1, maxBuildMinutes: -1, maxMemoryMb: 16384, maxCpuCores: 8, maxDomainsPerApp: -1, maxTeamMembers: -1, auditRetentionDays: 365 },
    features: { previewDeployments: true, teamCollaboration: true, customDomains: true, prioritySupport: true, sso: true, spendManagement: true, webhooks: true, apiAccess: true },
  },
]
// -1 = unlimited
```

---

## Phase 8: Frontend — Pricing Page (Public)

**New file**: `apps/web/src/app/pricing/page.tsx`

Public pricing page (outside dashboard, no auth required):
- 3-column tier comparison cards (Hobby / Pro / Enterprise)
- Feature comparison table with checkmarks
- "Get Started Free" → register → Hobby plan auto-assigned
- "Start Pro Trial" → register → 14-day trial
- "Contact Sales" → mailto or form for Enterprise
- Monthly/Annual toggle (annual = 2 months free)
- FAQ section at bottom

Design: shadcn Card components, follows existing UI patterns.

---

## Phase 9: Frontend — Billing Dashboard

**New file**: `apps/web/src/app/dashboard/billing/page.tsx`

Tab-based billing page:

### Tab 1: Overview
- Current plan card (plan name, price, renewal date)
- Usage summary bars (apps, databases, deployments, bandwidth, build minutes — each shows current/limit with progress bar)
- Spend management card (current spend vs limit, configure button)
- Quick actions: "Upgrade Plan", "Manage Payment Method"

### Tab 2: Plans
- Plan comparison (like pricing page but with "Current Plan" badge)
- Upgrade/downgrade buttons
- For downgrades: warning about feature loss

### Tab 3: Invoices
- Table: invoice number, date, amount, status (paid/open/failed), PDF download link
- Powered by Stripe invoice data synced locally

### Tab 4: Payment Method
- Current card on file (brand icon, last 4, expiry)
- "Update Payment Method" → Stripe Elements or redirect to Stripe Customer Portal
- Billing email setting

### Tab 5: Spend Management (Pro+ only)
- Current spend vs budget with visual bar
- Set/adjust spend limit input
- Notification thresholds (50%, 75%, 100%) — toggle email/in-app
- Hard cap toggle: "Pause deployments when limit reached"

### Sidebar
Add "Billing" item to dashboard sidebar with `CreditCard` icon, visible to owner/billing roles.

---

## Phase 10: Upgrade Flow & Trial

### New User Flow
1. Register (email/password or OAuth) → auto-create organization → assign Hobby plan (no Stripe customer created yet)
2. User uses platform on Hobby tier with enforced limits
3. User clicks "Upgrade to Pro" → Stripe Checkout session → enters card → subscription activated
4. OR: "Start Free Trial" → 14-day Pro access, no card required → trial ends → falls back to Hobby unless card added

### Trial Logic
**File**: `apps/api/src/services/trial.ts`

| Function | Purpose |
|----------|---------|
| `startTrial(orgId)` | Create subscription with `status: "trialing"`, set `trialEnd = now + 14 days` |
| `checkTrialEligibility(orgId)` | Ensure org hasn't trialed before (one trial per org) |
| `handleTrialEnd(orgId)` | Called by Stripe webhook or cron — downgrade to Hobby if no card |

### Upgrade Prompt UX
When a user hits a plan limit, show an inline upgrade banner:
- "You've used 3/3 applications on the Hobby plan. Upgrade to Pro for up to 25 apps."
- Button: "Upgrade to Pro — $20/mo" → Stripe Checkout

---

## Phase 11: Auto-Assign Hobby Plan on Registration

**Files to modify**:
- `apps/api/src/routers/auth.ts` — after creating user + default org, create a subscription record with Hobby plan
- `apps/api/src/routes/oauth.ts` — same for OAuth registrations (already creates default org)

This ensures every organization has a subscription from day 1 — simplifies all plan checks.

---

## Files Summary

| File | Action |
|------|--------|
| `packages/database/src/schema/index.ts` | Add `plans`, `subscriptions`, `invoices`, `usageRecords`, `paymentMethods` tables + relations. Add `stripeCustomerId` to organizations. |
| `packages/database/src/seed-plans.ts` | **NEW** — Seed the 3 pricing tiers |
| `apps/api/src/services/stripe.ts` | **NEW** — Stripe SDK wrapper (customers, subscriptions, checkout, portal, usage reporting) |
| `apps/api/src/services/usage-meter.ts` | **NEW** — Usage tracking + limit enforcement |
| `apps/api/src/services/trial.ts` | **NEW** — Trial start/end logic |
| `apps/api/src/routes/stripe-webhooks.ts` | **NEW** — Stripe webhook handler (raw body) |
| `apps/api/src/routers/billing.ts` | **NEW** — tRPC billing router (plans, subscriptions, invoices, spend management) |
| `apps/api/src/trpc/trpc.ts` | Add `subscribedProcedure`, `featureGuard`, `limitGuard` middleware |
| `apps/api/src/trpc/router.ts` | Register `billing` router |
| `apps/api/src/index.ts` | Mount Stripe webhook route (with raw body parser) |
| `apps/api/src/routers/auth.ts` | Auto-assign Hobby plan on registration |
| `apps/api/src/routes/oauth.ts` | Auto-assign Hobby plan on OAuth registration |
| `apps/api/src/queues/setup.ts` | Add `trackDeployment()` + `trackBuildMinutes()` + `enforceLimit()` calls |
| `apps/web/src/app/pricing/page.tsx` | **NEW** — Public pricing page |
| `apps/web/src/app/dashboard/billing/page.tsx` | **NEW** — Billing dashboard (overview, plans, invoices, payment, spend mgmt) |
| `apps/web/src/app/dashboard/layout.tsx` | Add "Billing" to sidebar |

---

## Env Vars

```
# apps/api/.env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_BANDWIDTH_PRICE_ID=price_...     # metered
STRIPE_BUILD_MINS_PRICE_ID=price_...    # metered
```

---

## Implementation Order — Phased with E2E Verification Gates

> **Rule**: Each step must be fully tested before moving to the next. Nothing should break existing functionality at any step. Every step is backward-compatible.

---

### Step 1: Database Schema + Seed Plans
**What**: Add all billing tables (`plans`, `subscriptions`, `invoices`, `usageRecords`, `paymentMethods`) and seed the 3 plan tiers. Add `stripeCustomerId` to organizations. Add `nodeId`/`deployTarget` columns are NOT part of this — billing only.

**Non-breaking**: New tables only, no existing tables modified except adding nullable `stripeCustomerId` column to `organizations`.

**Verification**:
- [ ] `pnpm --filter @guildserver/database db:push` succeeds
- [ ] API server starts without errors
- [ ] Web app loads without errors
- [ ] Existing features work: login, create app, deploy, view deployments
- [ ] Query `plans` table → 3 rows (Hobby, Pro, Enterprise)
- [ ] All existing tables still have their data intact

---

### Step 2: Auto-Assign Hobby Plan on Registration
**What**: When a new user registers (email/password or OAuth), auto-create a Hobby subscription record for their default organization. Existing users get backfilled with Hobby subscriptions via a one-time migration script.

**Non-breaking**: Only adds data on registration — no existing flows changed, no restrictions applied yet.

**Verification**:
- [ ] Register a new email/password user → check DB: `subscriptions` table has a row with `planId` = Hobby, `status` = "active"
- [ ] Register via GitHub OAuth → same result
- [ ] Existing users still work — login, deploy, everything unchanged
- [ ] Run backfill script → all existing orgs now have Hobby subscription records
- [ ] No errors in API logs

---

### Step 3: Stripe Service + Env Setup
**What**: Install `stripe` npm package. Create `stripe.ts` service with core functions (createCustomer, createCheckoutSession, createPortalSession, etc.). Add Stripe env vars. **No routes or endpoints yet** — just the service layer.

**Non-breaking**: New file only. No existing code calls it yet.

**Verification**:
- [ ] `pnpm --filter @guildserver/api add stripe` succeeds
- [ ] API server starts without errors (Stripe client initializes with test key)
- [ ] All existing features still work
- [ ] Import `stripe.ts` in a quick test script → `testConnection()` pings Stripe API successfully

---

### Step 4: Stripe Webhook Route
**What**: Create `stripe-webhooks.ts` Express route, mount at `/webhooks/stripe` with raw body parser. Handles subscription lifecycle events and syncs to local DB.

**Non-breaking**: New route only. Stripe won't send events until configured, so this is dormant.

**Verification**:
- [ ] API server starts without errors
- [ ] `POST /webhooks/stripe` with invalid signature → returns 400 (signature verification works)
- [ ] All existing features still work (especially existing `/webhooks` route for Git webhooks)
- [ ] Use Stripe CLI: `stripe trigger customer.subscription.created` → webhook received, logged correctly

---

### Step 5: tRPC Billing Router (Read-Only First)
**What**: Create `billing.ts` router with **read-only** procedures first: `getPlans`, `getCurrentPlan`, `getUsage`, `getInvoices`. No mutations yet. Register in `router.ts`.

**Non-breaking**: New router, new endpoints. Nothing calls them automatically.

**Verification**:
- [ ] API server starts without errors
- [ ] `trpc.billing.getPlans` → returns 3 plans with pricing info
- [ ] `trpc.billing.getCurrentPlan` (authenticated) → returns Hobby plan for current org
- [ ] `trpc.billing.getUsage` → returns zeroed usage counters
- [ ] All existing tRPC routes still work (test: create app, deploy, list deployments)

---

### Step 6: Billing Dashboard UI (Read-Only)
**What**: Create `/dashboard/billing/page.tsx` with Overview tab showing current plan card + usage summary. Add "Billing" to sidebar. **Display only** — no upgrade buttons wired yet.

**Non-breaking**: New page, sidebar link. No existing pages modified.

**Verification**:
- [ ] Web app builds without errors
- [ ] Navigate to `/dashboard/billing` → see "Hobby" plan card with usage at 0
- [ ] Sidebar shows "Billing" link with credit card icon
- [ ] All existing pages still work: applications, deployments, settings
- [ ] Mobile responsive: sidebar and billing page look correct

---

### Step 7: Usage Metering Service
**What**: Create `usage-meter.ts` with tracking functions. Wire `trackDeployment()` into `setup.ts` deployment worker (after successful deploy) and `trackBuildMinutes()` (after build completes). **Tracking only — no enforcement yet.**

**Non-breaking**: Only adds writes to `usageRecords` table. Deployment pipeline unchanged — just extra logging.

**Verification**:
- [ ] Deploy an app → check `usageRecords` table → deployment count incremented
- [ ] Build from git → `build_minutes` metric tracked
- [ ] `/dashboard/billing` now shows non-zero usage numbers
- [ ] `trpc.billing.getUsage` returns actual usage data
- [ ] Deployment speed not noticeably affected (metering is async)
- [ ] All deployments still succeed exactly as before

---

### Step 8: Plan Enforcement Middleware (Soft Gates)
**What**: Add `limitGuard` and `featureGuard` middleware to `trpc.ts`. Wire into **application creation** and **team member invite** procedures. Hobby users get blocked from exceeding limits with a clear error message + upgrade hint.

**Critical**: This is the first step that **changes existing behavior**. Hobby users will now have limits enforced.

**Non-breaking for Pro users**: Anyone with Pro subscription unaffected.
**Breaking for Hobby users (intentional)**: Hobby users with >3 apps already deployed won't be able to create new ones (existing apps keep running).

**Verification**:
- [ ] Hobby user: create 3 apps → success. Try 4th → error: "Upgrade to Pro for more applications"
- [ ] Hobby user: existing apps (even >3) still run, still accessible, still deployable
- [ ] Hobby user: all non-limited features still work (settings, view deployments, etc.)
- [ ] Pro user (or admin): no limits applied, can create unlimited apps
- [ ] Deploy an existing app → still works regardless of plan
- [ ] Feature gate: Hobby user tries preview deployment → blocked with message
- [ ] Feature gate: Pro user tries preview deployment → allowed

---

### Step 9: Billing Router Mutations (Upgrade/Downgrade)
**What**: Add mutation procedures to billing router: `createCheckoutSession`, `createPortalSession`, `changePlan`, `cancelSubscription`, `resumeSubscription`, `startTrial`. These call Stripe service.

**Non-breaking**: New endpoints. Existing functionality unchanged.

**Verification**:
- [ ] Call `billing.createCheckoutSession` → returns valid Stripe Checkout URL
- [ ] Open Checkout URL → Stripe test payment page loads
- [ ] Complete test payment (card 4242 4242 4242 4242) → webhook fires → subscription updated to Pro in DB
- [ ] Verify: `billing.getCurrentPlan` now returns Pro
- [ ] Verify: can now create >3 apps (limit enforced only on Hobby)
- [ ] Call `billing.cancelSubscription` → subscription marked `cancelAtPeriodEnd: true`
- [ ] Call `billing.createPortalSession` → Stripe Customer Portal URL works
- [ ] All existing features unaffected

---

### Step 10: Billing Dashboard UI (Full)
**What**: Complete the billing dashboard with all 5 tabs: Overview, Plans (with upgrade/downgrade buttons), Invoices, Payment Method, Spend Management. Wire up Stripe Checkout redirect and Portal redirect.

**Non-breaking**: UI changes to billing page only. No other pages affected.

**Verification**:
- [ ] Plans tab: shows 3 plans with "Current Plan" badge on Hobby
- [ ] Click "Upgrade to Pro" → redirects to Stripe Checkout → complete → redirected back → plan shows Pro
- [ ] Invoices tab: shows the invoice from the test payment
- [ ] Payment tab: shows the test card (Visa ending 4242)
- [ ] Click "Manage Billing" → opens Stripe Customer Portal
- [ ] Spend Management tab (Pro only): can set $50 limit, see 50/75/100% thresholds
- [ ] All existing dashboard pages still work

---

### Step 11: Public Pricing Page + Trial System
**What**: Create `/pricing` page (public, no auth). Implement 14-day trial system. Wire "Start Free Trial" button. Wire "Get Started Free" to registration.

**Non-breaking**: New public page. Trial is opt-in.

**Verification**:
- [ ] Visit `/pricing` (logged out) → see 3-tier comparison
- [ ] "Get Started Free" → goes to registration page
- [ ] Register → lands on dashboard with Hobby plan
- [ ] "Start Pro Trial" → creates trialing subscription → Pro features enabled for 14 days
- [ ] `billing.getCurrentPlan` shows `status: "trialing"`, `trialEnd` date
- [ ] Trial user can use Pro features (preview deployments, >3 apps, etc.)
- [ ] Simulate trial end (set trialEnd to past) → plan reverts to Hobby
- [ ] Second trial attempt → blocked: "Trial already used"
- [ ] All existing features still work

---

### Step 12: Spend Management + Overage Alerts
**What**: Wire spend management into deployment pipeline. At 50%/75%/100% of spend limit → send notifications (via existing notification system). At 100% with hard cap → pause new deployments.

**Non-breaking**: Only affects Pro users who have explicitly set a spend limit.

**Verification**:
- [ ] Set $5 spend limit on Pro plan
- [ ] Deploy several apps → at 50% → notification appears (in-app + email)
- [ ] At 75% → another notification
- [ ] At 100% with hard cap ON → next deployment blocked with "Spend limit reached"
- [ ] At 100% with hard cap OFF → deployment proceeds (just notification)
- [ ] Increase limit → can deploy again
- [ ] Users without spend limit → no restrictions
- [ ] Hobby users → unaffected (they have hard caps by plan limits, not spend)

---

## Stripe Setup (User Action Required)

1. Create Stripe account at https://dashboard.stripe.com
2. Get API keys (test mode) from Developers → API Keys
3. Create Products + Prices in Stripe Dashboard:
   - Product "GuildServer Pro" → Price $20/month/seat
   - Metered prices for bandwidth, build minutes
4. Set up webhook endpoint: `https://your-api.com/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`, `payment_method.*`
5. Copy webhook signing secret to `.env`
6. Install Stripe CLI for local testing: `stripe listen --forward-to localhost:4000/webhooks/stripe`
