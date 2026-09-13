import { planPrice, assertPaymentSelection } from "../../src/services/billing/catalog";
const plan = { slug: "starter", priceMonthly: 1200, priceYearly: 12000 };
describe("billing catalog", () => {
  afterEach(() => { delete process.env.BILLING_STARTER_NGN_MONTHLY_KOBO });
  it("uses server catalog USD prices", () => { expect(planPrice(plan, "USD", "monthly")).toBe(1200); expect(planPrice(plan, "USD", "yearly")).toBe(12000) });
  it("never relabels USD cents as NGN", () => { expect(planPrice(plan, "NGN", "monthly")).toBeNull() });
  it("uses an explicitly configured fixed NGN price", () => { process.env.BILLING_STARTER_NGN_MONTHLY_KOBO = "1800000"; expect(planPrice(plan, "NGN", "monthly")).toBe(1800000) });
  it("rejects unsafe fractional price configuration", () => { process.env.BILLING_STARTER_NGN_MONTHLY_KOBO = "0.2"; expect(() => planPrice(plan, "NGN", "monthly")).toThrow() });
  it("allows NGN transfers and USD cards, rejecting USD transfers", () => { expect(() => assertPaymentSelection("NGN", "bank_transfer")).not.toThrow(); expect(() => assertPaymentSelection("USD", "card")).not.toThrow(); expect(() => assertPaymentSelection("USD", "bank_transfer")).toThrow() });
});
