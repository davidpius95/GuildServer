import { normalizeCurrency } from "./money";

/** Independent fixed NGN prices in kobo; never reinterpret USD cents as NGN. */
export function planPrice(plan: { slug: string; priceMonthly: number | null; priceYearly: number | null }, currency: string, interval: "monthly" | "yearly"): number | null {
  const code = normalizeCurrency(currency);
  if (code !== "usd" && code !== "ngn") throw new Error("Choose NGN or USD");
  if (plan.slug === "hobby") return 0;
  if (plan.slug === "enterprise") return null;
  if (code === "usd") return interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
  const key = `BILLING_${plan.slug.toUpperCase()}_NGN_${interval.toUpperCase()}_KOBO`;
  const value = process.env[key];
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Invalid price configuration: ${key}`);
  return amount;
}

export function assertPaymentSelection(currency: string, method: string): void {
  const code = normalizeCurrency(currency);
  if (!["usd", "ngn"].includes(code)) throw new Error("Choose NGN or USD");
  if (method !== "card" && !(code === "ngn" && method === "bank_transfer")) {
    throw new Error("Bank transfer is available for NGN. Choose card for USD.");
  }
}
