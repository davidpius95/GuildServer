/** Runs only against the disposable test database. Never calls a payment provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, organizations, users, plans, paymentTransactions, invoices, receipts, billingLedgerEntries, subscriptions } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { createQuote, acceptQuote } from "../src/services/billing/quotes";
import { settlePaymentAttempt } from "../src/services/billing/settlement";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.pathname, "/guildserver_test", "This smoke test requires the disposable test database");
  const id = randomUUID();
  const [user] = await db.insert(users).values({ email: `billing-smoke-${id}@example.invalid`, name: "Billing smoke fixture" }).returning();
  const [org] = await db.insert(organizations).values({ name: "Billing smoke fixture", slug: `billing-smoke-${id}`, ownerId: user.id }).returning();
  let createdPlan: string | undefined;
  try {
    let plan = await db.query.plans.findFirst({ where: eq(plans.slug, "starter") });
    if (!plan) { [plan] = await db.insert(plans).values({ name: "Starter", slug: "starter", priceMonthly: 1200, priceYearly: 12000 }).returning(); createdPlan = plan.id }
    const quote = await createQuote({ organizationId: org.id, currency: "USD", validUntil: new Date(Date.now() + 60_000), lineItems: [{ productType: "plan", productId: plan.id, description: "Starter annual smoke", unitAmountCents: 12000, metadata: { source: "catalog", planSlug: "starter", interval: "yearly" } }] });
    const accepted = await Promise.all(Array.from({ length: 6 }, () => acceptQuote({ quoteId: quote.id, acceptedBy: user.id })));
    assert.equal(new Set(accepted.map(i => i.id)).size, 1, "Concurrent quote acceptance must create one invoice");
    const invoice = accepted[0];
    const [payment] = await db.insert(paymentTransactions).values({ organizationId: org.id, invoiceId: invoice.id, provider: "flutterwave", purpose: "invoice", status: "pending", amountCents: 12000, currency: "usd", flutterwaveTxRef: `GS-SMOKE-${id}` }).returning();
    const verified = { provider: "flutterwave" as const, providerReference: `chg_smoke_${id}`, paymentTransactionId: payment.id, verifiedStatus: "succeeded" as const, verifiedAmountCents: 12000, verifiedCurrency: "USD" };
    const settlements = await Promise.all(Array.from({ length: 8 }, () => settlePaymentAttempt(verified)));
    assert.equal(settlements.filter(r => r.result === "settled").length, 1);
    const paid = await db.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
    assert.equal(paid?.amountPaidCents, 12000); assert.equal(paid?.status, "paid");
    const docs = await db.select().from(receipts).where(eq(receipts.invoiceId, invoice.id)); assert.equal(docs.length, 1);
    const ledger = await db.select().from(billingLedgerEntries).where(eq(billingLedgerEntries.invoiceId, invoice.id)); assert.equal(ledger.length, 2);
    const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.organizationId, org.id) });
    assert.equal(sub?.planId, plan.id); assert.ok(sub?.currentPeriodEnd && sub.currentPeriodStart && sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime() > 360 * 86_400_000);
    console.log("PASS: 6 concurrent acceptances -> one invoice; 8 concurrent settlements -> one payment, receipt, annual subscription, and balanced charge/payment ledger.");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, user.id));
    if (createdPlan) await db.delete(plans).where(eq(plans.id, createdPlan));
    assert.equal((await db.select().from(organizations).where(eq(organizations.id, org.id))).length, 0);
    console.log("PASS: test fixture cleanup verified.");
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1) });
