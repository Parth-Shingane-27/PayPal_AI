import { AppError } from "../errors";

/**
 * Money is integer minor units plus an ISO 4217 code. These helpers are the
 * only place that converts between minor units, decimal strings and display
 * strings. Floats are never stored.
 */

/** Every currency a market, a seller or a product cost can use. */
export const SUPPORTED_CURRENCIES = ["USD", "GBP", "CAD", "AUD", "EUR", "MXN", "JPY"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const EXPONENTS: Record<Currency, number> = { USD: 2, GBP: 2, CAD: 2, AUD: 2, EUR: 2, MXN: 2, JPY: 0 };

export function isSupportedCurrency(currency: string): currency is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency);
}

export function currencyExponent(currency: string): number {
  if (!isSupportedCurrency(currency)) throw new AppError("INVALID_INPUT", `Unsupported currency: ${currency}`);
  return EXPONENTS[currency];
}

/** A money value as tools and APIs return it: exact minor units plus display text. */
type MoneyView = { amount_minor: number; currency: string; display: string };

export function formatMoney(amountMinor: number, currency: string, locale = "en-US"): string {
  const e = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: e,
    maximumFractionDigits: e,
  }).format(amountMinor / 10 ** e);
}

export function money(amountMinor: number, currency: string, locale = "en-US"): MoneyView {
  if (!Number.isSafeInteger(amountMinor)) throw new Error(`Money must be an integer, got ${amountMinor}`);
  return { amount_minor: amountMinor, currency, display: formatMoney(amountMinor, currency, locale) };
}

/** Minor units to the decimal string PayPal expects ("12.34", "1200"). */
export function toDecimalString(amountMinor: number, currency: string): string {
  const e = currencyExponent(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  if (e === 0) return `${sign}${abs}`;
  const whole = Math.floor(abs / 10 ** e);
  const frac = String(abs % 10 ** e).padStart(e, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * Strict decimal string to minor units. Rejects more fraction digits than the
 * currency allows, so "12.345 USD" is an error rather than silently rounded.
 */
export function parseDecimal(value: string, currency: string): number {
  const e = currencyExponent(currency);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new AppError("INVALID_INPUT", `"${value}" is not a valid ${currency} amount.`);
  const [, neg, whole, frac = ""] = match;
  if (frac.length > e) {
    throw new AppError("INVALID_INPUT", `${currency} amounts allow at most ${e} decimal places; got "${value}".`);
  }
  const minor = Number(whole) * 10 ** e + Number(frac.padEnd(e, "0") || "0");
  if (!Number.isSafeInteger(minor)) throw new AppError("INVALID_INPUT", `Amount "${value}" is too large.`);
  return neg ? -minor : minor;
}

/** amount × bps / 10 000, rounded half up. All percentage maths goes through here. */
export function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10_000);
}

/** Converts between currencies with a decimal rate (1 `from` = rate `to`), rounded half up. */
export function convertMinor(amountMinor: number, from: string, to: string, rate: number): number {
  const major = amountMinor / 10 ** currencyExponent(from);
  return Math.round(major * rate * 10 ** currencyExponent(to));
}

/** "30" or "32.5" percent to basis points, without floats. */
export function parsePercentToBps(value: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new AppError("INVALID_INPUT", `"${value}" is not a valid percentage.`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
