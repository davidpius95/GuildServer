# Billing, Quotes, Receipts, Stripe, and Flutterwave Design

## Goal

Build a provider-neutral billing core for GuildServer that supports quotes, invoices, receipts, credits, refunds, subscriptions, usage charges, Stripe, and Flutterwave without trusting provider webhooks as the source of financial truth.

## Current State

GuildServer already has partial billing:

- Plans, subscriptions, invoices, usage records, Stripe payment methods, cross-provider payment transactions, and crypto payments exist in `packages/database/src/schema/index.ts`.
- Stripe checkout, portal, customer, subscription, invoice, and payment-method webhook helpers exist under `apps/api/src/services/billing`.
- Flutterwave v4 charge creation, customer caching, virtual accounts, bank lists, and webhook verification exist under `apps/api/src/services/billing` and `apps/api/src/handlers`.
- The billing dashboard and checkout modals exist, but the older payment-method modal calls stale router procedures.

The current gap is not payment initiation. The gap is the finance core around payment initiation:

- No quote table or quote acceptance flow.
- No invoice line items.
- No immutable ledger entries for charges, payments, credits, refunds, and adjustments.
- No local receipt records.
- No provider-neutral settlement service that turns a verified provider payment into the same GuildServer business outcome.
- Stripe production secrets are not configured on the server; Flutterwave v4 production variables are configured.

## Architecture

GuildServer owns commercial state. Stripe and Flutterwave are payment rails only.

The local database must record:

- Product and price snapshot at time of quote or invoice.
- Quote status and expiry.
- Invoice header and immutable invoice line items.
- Payment attempts and verified provider status.
- Ledger entries for every financial movement.
- Receipts issued after successful allocation.
- Credit notes and refunds.

Provider callbacks must only identify the payment event. GuildServer must fetch or verify provider state, compare amount/currency/provider reference with the local payment transaction, then call a single idempotent settlement function.

## Invariants

- Amounts are stored as integer minor units, using the existing `amount_cents` convention for two-decimal currencies.
- Currency is lowercase ISO code in local tables and uppercase at provider boundaries.
- Quotes do not mutate subscriptions or provision compute until accepted and paid, unless explicitly marked as zero-value.
- Invoice totals are derived from invoice line items, not free-text metadata.
- A payment transaction can be settled once. Replayed webhooks must return the existing settlement result.
- Receipts are issued only after the payment is verified and allocated.
- Refunds and credits never delete or rewrite prior charge/payment ledger rows; they add reversing rows.
- Stripe webhooks and Flutterwave webhooks must both call the same settlement service.
- Webhook payloads are not trusted for amount, currency, or final paid state without provider verification.
- Production migrations remain manual-gated until the live Drizzle journal policy is resolved.

## Provider Scope

Stripe:

- Primary USD card and hosted invoice rail.
- Subscription Checkout and customer portal can remain.
- Invoice and subscription events must settle into local invoices, ledger entries, and receipts.
- Usage billing should move toward Stripe meter events after the local ledger is in place.

Flutterwave:

- Primary NGN rail and secondary USD/card rail where Flutterwave supports it.
- Payment methods include card, bank transfer, mobile money, USSD, and virtual account funding.
- Automatic recurring NGN collection is feature-flagged until provider approval and card-on-file/direct-debit readiness are confirmed.
- Webhook verification and authoritative charge fetch remain mandatory.

## MVP Acceptance

The first shippable billing MVP is complete when:

- An owner/admin can create a quote for plan/instance/top-up items.
- A quote can be accepted into an invoice.
- An invoice can be paid by Stripe or Flutterwave.
- A verified provider payment updates the payment transaction, invoice, ledger, and receipt exactly once.
- The billing dashboard can list quotes, invoices, receipts, and payment state.
- Failed, underpaid, duplicate, and replayed provider events are tested.
- Admin/operator docs describe Stripe and Flutterwave env vars, webhook URLs, and manual migration steps.
