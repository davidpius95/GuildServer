# Billing Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GuildServer's provider-neutral billing core for quotes, invoices, receipts, Stripe, and Flutterwave settlement.

**Architecture:** GuildServer owns quotes, invoices, line items, ledger entries, receipts, refunds, and entitlements. Stripe and Flutterwave only initiate and verify payment attempts; both providers settle through one idempotent service.

**Tech Stack:** TypeScript, Node.js, Express, tRPC, Drizzle ORM, PostgreSQL, Jest, Stripe SDK, Flutterwave v4 client.

**Spec:** `docs/superpowers/specs/2026-08-20-billing-quotes-design.md`

## Global Constraints

- Store money as integer minor units in local database columns.
- Keep provider-specific logic behind service boundaries under `apps/api/src/services/billing`.
- Do not trust webhook body amount, currency, or final status without provider verification.
- Do not auto-run production migrations from cron; production migration remains an explicit operator step.
- Do not expose or print Stripe, Flutterwave, or database secrets.
- Use owner/admin membership checks for billing mutations.

---

## File Structure

- Modify `packages/database/src/schema/index.ts`: add quote, invoice line item, receipt, ledger, credit note, refund, and richer payment enums/tables.
- Create `packages/database/migrations/0010_billing_quotes_core.sql`: additive billing schema migration with indexes and uniqueness constraints.
- Create `apps/api/src/services/billing/money.ts`: currency normalization, minor/major unit conversion, and amount validation.
- Create `apps/api/src/services/billing/ledger.ts`: append-only ledger writer and idempotency helpers.
- Create `apps/api/src/services/billing/quotes.ts`: quote draft, line totals, expiry, acceptance, and invoice creation.
- Create `apps/api/src/services/billing/invoices.ts`: invoice totals, payment allocation, paid-state transitions, and receipt creation.
- Create `apps/api/src/services/billing/settlement.ts`: provider-neutral payment settlement entry point.
- Modify `apps/api/src/services/billing/flutterwave-v4.ts`: create payment attempts with invoice/quote metadata and reuse money helpers.
- Modify `apps/api/src/handlers/flutterwave-v4-webhooks.ts`: call `settlePaymentAttempt` after verified Flutterwave charge fetch.
- Modify `apps/api/src/handlers/stripe-webhooks.ts`: call `settlePaymentAttempt` or invoice sync helpers for relevant Stripe events.
- Modify `apps/api/src/routers/billing.ts`: expose quote, invoice payment, receipt, and provider availability procedures.
- Modify `apps/web/src/app/dashboard/billing/page.tsx`: show quotes, invoices, receipts, and payment actions.
- Modify `apps/web/src/components/billing/flutterwave-checkout-modal.tsx`: pay invoice via Flutterwave v4.
- Modify `apps/web/src/components/billing/payment-method-modal.tsx`: remove stale procedure names or replace with provider-neutral payment selection.
- Create `apps/api/tests/services/billing-money.test.ts`: money conversion and validation tests.
- Create `apps/api/tests/services/billing-settlement.test.ts`: idempotent payment settlement tests.
- Create `apps/api/tests/routers/billing-quotes.test.ts`: quote/invoice API tests.
- Create `apps/api/tests/handlers/flutterwave-v4-webhooks.test.ts`: replay, underpayment, and settlement tests.
- Update `docs/billing-pricing-plan.md`: replace stale "no billing code exists" assumptions with current architecture.
- Update `apps/docs/docs/billing/*.md`: operator setup and user billing behavior.

## Task 1: Billing Core Schema

**Files:**
- Modify: `packages/database/src/schema/index.ts`
- Create: `packages/database/migrations/0010_billing_quotes_core.sql`

**Interfaces:**
- Produces: `quotes`, `quoteLineItems`, `invoiceLineItems`, `billingLedgerEntries`, `receipts`, `creditNotes`, `refunds`
- Produces enums: `quote_status`, `billing_ledger_entry_type`, `receipt_status`, `refund_status`

- [x] **Step 1: Add schema enums and tables**

Add additive tables only. Required columns:

```ts
export const quoteStatusEnum = pgEnum("quote_status", ["draft", "sent", "accepted", "expired", "canceled"]);
export const billingLedgerEntryTypeEnum = pgEnum("billing_ledger_entry_type", ["charge", "payment", "credit", "refund", "adjustment"]);
export const receiptStatusEnum = pgEnum("receipt_status", ["issued", "void"]);
export const refundStatusEnum = pgEnum("refund_status", ["pending", "succeeded", "failed", "canceled"]);
```

`quotes` must include `organizationId`, `number`, `status`, `currency`, `subtotalCents`, `taxCents`, `discountCents`, `totalCents`, `validUntil`, `acceptedAt`, `acceptedBy`, `invoiceId`, `metadata`, timestamps.

`quote_line_items` and `invoice_line_items` must snapshot description, quantity, unit amount, subtotal, tax, discount, total, product type, and metadata.

`billing_ledger_entries` must include `organizationId`, nullable `invoiceId`, nullable `paymentTransactionId`, nullable `receiptId`, `type`, `amountCents`, `currency`, `description`, `idempotencyKey`, `metadata`, `createdAt`; `idempotencyKey` must be unique.

`receipts` must include `organizationId`, `invoiceId`, `paymentTransactionId`, `number`, `status`, `amountCents`, `currency`, `issuedAt`, `receiptUrl`, `pdfUrl`, `metadata`, timestamps.

`credit_notes` and `refunds` must be additive and nullable where provider state is not known yet.

- [x] **Step 2: Add SQL migration**

Create `0010_billing_quotes_core.sql` with `CREATE TYPE` guarded by `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`, `CREATE TABLE IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS`.

- [x] **Step 3: Run typecheck**

Run: `pnpm --filter @guildserver/database build`

Expected: TypeScript schema compiles.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/database/src/schema/index.ts packages/database/migrations/0010_billing_quotes_core.sql
git commit -m "feat: add billing quotes core schema"
```

## Task 2: Money and Ledger Services

**Files:**
- Create: `apps/api/src/services/billing/money.ts`
- Create: `apps/api/src/services/billing/ledger.ts`
- Create: `apps/api/tests/services/billing-money.test.ts`

**Interfaces:**
- Consumes: billing schema from Task 1
- Produces: `normalizeCurrency(currency: string): string`
- Produces: `toMajorUnits(amountMinor: number, currency: string): number`
- Produces: `toMinorUnits(amountMajor: number, currency: string): number`
- Produces: `assertPositiveMinorAmount(amountMinor: number): void`
- Produces: `appendLedgerEntry(args): Promise<BillingLedgerEntry>`

- [x] **Step 1: Write money tests**

Test USD/NGN conversion, zero-decimal conversion, lowercase storage normalization, and rejection of non-integer/negative amounts.

- [x] **Step 2: Implement money helpers**

Move the conversion rules currently duplicated in Flutterwave v4 into `money.ts`, then import them from Flutterwave.

- [x] **Step 3: Implement ledger append helper**

`appendLedgerEntry` inserts by `idempotencyKey`; if a duplicate key exists, it returns the existing row instead of throwing.

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter @guildserver/api test -- billing-money.test.ts`

- [x] **Step 5: Commit**

Run:

```bash
git add apps/api/src/services/billing/money.ts apps/api/src/services/billing/ledger.ts apps/api/tests/services/billing-money.test.ts apps/api/src/services/billing/flutterwave-v4.ts
git commit -m "feat: add billing money and ledger services"
```

## Task 3: Quote and Invoice Services

**Files:**
- Create: `apps/api/src/services/billing/quotes.ts`
- Create: `apps/api/src/services/billing/invoices.ts`
- Create: `apps/api/tests/routers/billing-quotes.test.ts`

**Interfaces:**
- Consumes: `appendLedgerEntry`, money helpers
- Produces: `createQuote(args): Promise<QuoteWithLines>`
- Produces: `acceptQuote(args): Promise<InvoiceWithLines>`
- Produces: `createInvoiceFromQuote(args): Promise<InvoiceWithLines>`
- Produces: `recalculateInvoiceTotals(invoiceId: string): Promise<void>`

- [x] **Step 1: Write quote router tests**

Cover immutable quote totals, quote creation, expired quote rejection, replayed acceptance, and accepted quote creates one invoice. Router-level membership tests move to Task 5 where the tRPC procedures are introduced.

- [x] **Step 2: Implement quote totals**

Compute totals from line items and persist snapshots. Never calculate from mutable plan/instance price after quote creation.

- [x] **Step 3: Implement quote acceptance**

Use a database transaction. Update quote status to `accepted`, create invoice and invoice line items, link `quotes.invoiceId`.

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter @guildserver/api test -- billing-quotes.test.ts`

- [x] **Step 5: Commit**

Run:

```bash
git add apps/api/src/services/billing/quotes.ts apps/api/src/services/billing/invoices.ts apps/api/tests/routers/billing-quotes.test.ts
git commit -m "feat: add quote acceptance invoices"
```

## Task 4: Provider-Neutral Settlement

**Files:**
- Create: `apps/api/src/services/billing/settlement.ts`
- Create: `apps/api/tests/services/billing-settlement.test.ts`
- Modify: `apps/api/src/handlers/flutterwave-v4-webhooks.ts`
- Modify: `apps/api/src/handlers/stripe-webhooks.ts`

**Interfaces:**
- Consumes: `appendLedgerEntry`
- Consumes: invoice and receipt tables
- Produces: `settlePaymentAttempt(args): Promise<SettlementResult>`

Settlement input:

```ts
type SettlePaymentAttemptArgs = {
  provider: "stripe" | "flutterwave" | "crypto";
  providerReference: string;
  paymentTransactionId?: string;
  verifiedStatus: "succeeded" | "failed" | "canceled" | "expired" | "processing";
  verifiedAmountCents: number;
  verifiedCurrency: string;
  rawProviderPayload?: unknown;
};
```

- [ ] **Step 1: Write settlement tests**

Cover successful invoice payment, replayed successful webhook, underpayment rejected, wrong currency rejected, failed provider status preserved, receipt created once.

- [ ] **Step 2: Implement settlement transaction**

Inside one DB transaction, lock or re-read the payment transaction, validate amount/currency, update transaction, update invoice paid amount/status, append ledger payment entry, create receipt if invoice is fully paid.

- [ ] **Step 3: Wire Flutterwave v4 webhook**

After `fetchCharge(chargeId)` and validation, call `settlePaymentAttempt` instead of directly updating invoice/payment side effects.

- [ ] **Step 4: Wire Stripe webhook**

For `invoice.paid`, `checkout.session.completed`, and `payment_intent.succeeded`, resolve the local payment transaction or invoice and call settlement/sync helpers.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @guildserver/api test -- billing-settlement.test.ts flutterwave-v4-webhooks.test.ts`

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/api/src/services/billing/settlement.ts apps/api/tests/services/billing-settlement.test.ts apps/api/src/handlers/flutterwave-v4-webhooks.ts apps/api/src/handlers/stripe-webhooks.ts
git commit -m "feat: settle billing payments idempotently"
```

## Task 5: Billing Router API

**Files:**
- Modify: `apps/api/src/routers/billing.ts`
- Modify: `apps/api/src/services/billing/flutterwave-v4.ts`

**Interfaces:**
- Consumes: quote, invoice, settlement services
- Produces tRPC procedures: `getPaymentProviders`, `listQuotes`, `createQuote`, `acceptQuote`, `getInvoice`, `payInvoiceWithFlutterwave`, `listReceipts`

- [ ] **Step 1: Add router tests for procedures**

Cover permission checks, provider availability, invoice payment transaction creation, and stale procedure compatibility.

- [ ] **Step 2: Add `getPaymentProviders`**

Return Stripe and Flutterwave availability based on current env config. Do not expose secret values.

- [ ] **Step 3: Add quote and receipt read APIs**

Expose quote/invoice/receipt lists with stable shape for the dashboard.

- [ ] **Step 4: Add invoice payment mutation**

`payInvoiceWithFlutterwave` creates or reuses a pending `payment_transactions` row for the invoice and returns next action details.

- [ ] **Step 5: Run router tests**

Run: `pnpm --filter @guildserver/api test -- billing`

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/api/src/routers/billing.ts apps/api/src/services/billing/flutterwave-v4.ts apps/api/tests/routers/billing-quotes.test.ts
git commit -m "feat: expose billing quotes and invoice payments"
```

## Task 6: Dashboard Billing UI

**Files:**
- Modify: `apps/web/src/app/dashboard/billing/page.tsx`
- Modify: `apps/web/src/components/billing/flutterwave-checkout-modal.tsx`
- Modify: `apps/web/src/components/billing/payment-method-modal.tsx`

**Interfaces:**
- Consumes: tRPC procedures from Task 5
- Produces: dashboard lists for plan, quote, invoice, receipt, and payment status

- [ ] **Step 1: Add component tests or update existing billing mocks**

Mock `getPaymentProviders`, quote list, invoice list, and receipts.

- [ ] **Step 2: Replace stale procedure calls**

Remove calls to `getAvailablePaymentProviders` and `createFlutterwaveSubscriptionCheckout`. Use `getPaymentProviders` and `payInvoiceWithFlutterwave`.

- [ ] **Step 3: Add invoice payment states**

Show `open`, `paid`, `void`, and `uncollectible` invoices. Disable pay actions for paid/void invoices.

- [ ] **Step 4: Run web checks**

Run: `pnpm --filter @guildserver/web typecheck`

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/app/dashboard/billing/page.tsx apps/web/src/components/billing/flutterwave-checkout-modal.tsx apps/web/src/components/billing/payment-method-modal.tsx
git commit -m "feat: add billing dashboard quote payments"
```

## Task 7: Operator Docs and Launch Checklist

**Files:**
- Modify: `docs/billing-pricing-plan.md`
- Modify: `apps/docs/docs/billing/plans.md`
- Modify: `apps/docs/docs/billing/stripe-integration.md`
- Modify: `apps/docs/docs/billing/usage-tracking.md`
- Modify: `apps/docs/docs/api/billing.md`

**Interfaces:**
- Consumes: completed API/UI behavior
- Produces: deployment checklist and operator setup guide

- [ ] **Step 1: Update architecture docs**

Describe local quote/invoice/ledger ownership and provider settlement boundaries.

- [ ] **Step 2: Add env checklist**

Document `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FLW_V4_CLIENT_ID`, `FLW_V4_CLIENT_SECRET`, `FLW_V4_WEBHOOK_SECRET_HASH`, webhook URLs, and public frontend return URLs without secret values.

- [ ] **Step 3: Add migration checklist**

Document backup, apply migration, verify tables/indexes, and rollback notes.

- [ ] **Step 4: Run docs grep**

Run: `rg -n "no billing code exists|getAvailablePaymentProviders|createFlutterwaveSubscriptionCheckout" docs apps/docs apps/web/src`

Expected: no stale claims or stale procedure names remain.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs apps/docs
git commit -m "docs: document billing launch checklist"
```

## Self-Review

- Spec coverage: quotes, invoice lines, provider-neutral settlement, receipts, refunds/credits, Stripe, Flutterwave, dashboard, and operator docs are covered.
- Placeholder scan: no task uses TODO/TBD or undefined "handle later" language.
- Type consistency: provider names match existing `payment_provider`; status names match existing `payment_transaction_status`; new interfaces are named before use.
- Main risk: production Drizzle journal has manual history, so migration execution must be an operator-gated step with backup verification.
