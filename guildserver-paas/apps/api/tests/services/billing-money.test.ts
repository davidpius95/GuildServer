import {
  assertPositiveMinorAmount,
  normalizeCurrency,
  toMajorUnits,
  toMinorUnits,
} from "../../src/services/billing/money";

describe("billing money helpers", () => {
  it("normalizes currency for database storage", () => {
    expect(normalizeCurrency("usd")).toBe("usd");
    expect(normalizeCurrency(" NGN ")).toBe("ngn");
  });

  it("converts two-decimal currencies between minor and major units", () => {
    expect(toMajorUnits(12345, "usd")).toBe(123.45);
    expect(toMajorUnits(250000, "NGN")).toBe(2500);
    expect(toMinorUnits(123.45, "usd")).toBe(12345);
    expect(toMinorUnits(2500, "ngn")).toBe(250000);
  });

  it("keeps zero-decimal currencies in whole units", () => {
    expect(toMajorUnits(5000, "jpy")).toBe(5000);
    expect(toMinorUnits(5000, "JPY")).toBe(5000);
  });

  it("rejects invalid currencies", () => {
    expect(() => normalizeCurrency("")).toThrow("currency is required");
    expect(() => normalizeCurrency("US")).toThrow("currency must be a 3-letter ISO code");
    expect(() => normalizeCurrency("USDD")).toThrow("currency must be a 3-letter ISO code");
  });

  it("rejects non-positive or non-integer minor amounts", () => {
    expect(() => assertPositiveMinorAmount(100)).not.toThrow();
    expect(() => assertPositiveMinorAmount(0)).toThrow("amountMinor must be a positive integer");
    expect(() => assertPositiveMinorAmount(-1)).toThrow("amountMinor must be a positive integer");
    expect(() => assertPositiveMinorAmount(10.5)).toThrow("amountMinor must be a positive integer");
  });
});
