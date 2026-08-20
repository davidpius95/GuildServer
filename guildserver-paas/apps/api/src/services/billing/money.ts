const ZERO_DECIMAL_CURRENCIES = new Set(["jpy", "krw", "vnd", "clp", "xof", "xaf", "rwf", "ugx"]);

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toLowerCase();
  if (!normalized) {
    throw new Error("currency is required");
  }
  if (!/^[a-z]{3}$/.test(normalized)) {
    throw new Error("currency must be a 3-letter ISO code");
  }
  return normalized;
}

export function assertPositiveMinorAmount(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("amountMinor must be a positive integer");
  }
}

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(normalizeCurrency(currency));
}

export function toMajorUnits(amountMinor: number, currency: string): number {
  assertPositiveMinorAmount(amountMinor);
  if (isZeroDecimalCurrency(currency)) return amountMinor;
  return Number((amountMinor / 100).toFixed(2));
}

export function toMinorUnits(amountMajor: number, currency: string): number {
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    throw new Error("amountMajor must be a positive number");
  }
  if (isZeroDecimalCurrency(currency)) return Math.round(amountMajor);
  return Math.round(amountMajor * 100);
}
