import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" as any })
  : null;

export function isStripeConfigured(): boolean {
  return stripe !== null;
}

export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.");
  }
  return stripe;
}

export function mapStripeStatus(status: Stripe.Subscription.Status): string {
  const mapping: Record<string, string> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "past_due",
    incomplete: "incomplete",
    incomplete_expired: "canceled",
    paused: "paused",
  };
  return mapping[status] || "active";
}

export function mapInvoiceStatus(status: string | null): string {
  if (!status) return "draft";
  const mapping: Record<string, string> = {
    draft: "draft",
    open: "open",
    paid: "paid",
    void: "void",
    uncollectible: "uncollectible",
  };
  return mapping[status] || "draft";
}
