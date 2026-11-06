import { type Currency, convertMinor, isSupportedCurrency } from "./money";

/**
 * Fixed, indicative exchange rates (units per 1 USD). Used only to put a
 * multi-currency seller's KPIs and charts on one axis, and by the seed to set
 * plausible local prices. Every figure derived from these is labelled
 * "at reference rates" in the UI; ledgers and grids keep native currencies.
 */
export const REFERENCE_USD_RATES: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.37,
  AUD: 1.52,
  MXN: 18.2,
  JPY: 152,
};

export function referenceRate(from: string, to: string): number {
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) throw new Error(`No reference rate for ${from}->${to}`);
  return REFERENCE_USD_RATES[to] / REFERENCE_USD_RATES[from];
}

/** Converts minor units between currencies at the reference rate. */
export function convertAtReference(amountMinor: number, from: string, to: string): number {
  if (from === to) return amountMinor;
  return convertMinor(amountMinor, from, to, referenceRate(from, to));
}
