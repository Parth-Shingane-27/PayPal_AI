import { currencyExponent } from "./money";

/**
 * The markets GlobalGig serves. A market is a locale: it fixes the
 * service-page language, the currency clients pay in, and price rounding.
 */

export type Rounding = "x99" | "ends9" | "tens";

export type Market = {
  locale: string;
  country: string;
  currency: string;
  /** English name of the listing language, for prompts and UI. */
  language: string;
  units: "metric" | "imperial";
  rounding: Rounding;
};

const LIST: Market[] = [
  { locale: "en-US", country: "US", currency: "USD", language: "English (US)", units: "imperial", rounding: "x99" },
  { locale: "en-GB", country: "GB", currency: "GBP", language: "English (UK)", units: "metric", rounding: "x99" },
  { locale: "en-CA", country: "CA", currency: "CAD", language: "English (Canada)", units: "metric", rounding: "x99" },
  { locale: "en-AU", country: "AU", currency: "AUD", language: "English (Australia)", units: "metric", rounding: "x99" },
  { locale: "de-DE", country: "DE", currency: "EUR", language: "German", units: "metric", rounding: "x99" },
  { locale: "fr-FR", country: "FR", currency: "EUR", language: "French", units: "metric", rounding: "x99" },
  { locale: "es-ES", country: "ES", currency: "EUR", language: "Spanish (Spain)", units: "metric", rounding: "x99" },
  { locale: "it-IT", country: "IT", currency: "EUR", language: "Italian", units: "metric", rounding: "x99" },
  { locale: "es-MX", country: "MX", currency: "MXN", language: "Spanish (Mexico)", units: "metric", rounding: "ends9" },
  { locale: "ja-JP", country: "JP", currency: "JPY", language: "Japanese", units: "metric", rounding: "tens" },
  // PayPal accepts INR only for accounts registered in India, so India pays in USD.
  { locale: "hi-IN", country: "IN", currency: "USD", language: "Hindi", units: "metric", rounding: "x99" },
];

const MARKETS: ReadonlyMap<string, Market> = new Map(LIST.map((m) => [m.locale, m]));
export const MARKET_LOCALES = LIST.map((m) => m.locale) as [string, ...string[]];

export function listMarkets(): Market[] {
  return [...LIST];
}

export function isMarketLocale(locale: string): boolean {
  return MARKETS.has(locale);
}

/** Throws for unknown locales; callers validate input first. */
export function getMarket(locale: string): Market {
  const market = MARKETS.get(locale);
  if (!market) throw new Error(`Unknown market locale: ${locale}`);
  return market;
}

/**
 * Natural price points, always rounding UP so the margin is never reduced:
 *  - x99:   12.34 -> 12.99, 12.99 -> 12.99
 *  - ends9: whole units ending in 9 (MXN): 123.45 -> 129.00
 *  - tens:  multiples of 10 (JPY): 1234 -> 1240
 */
export function roundUpToPricePoint(minor: number, rounding: Rounding, currency: string): number {
  const unit = 10 ** currencyExponent(currency);
  switch (rounding) {
    case "x99":
      return Math.ceil((minor + 1) / unit) * unit - 1;
    case "ends9": {
      const whole = Math.ceil(minor / unit);
      return (Math.ceil((whole + 1) / 10) * 10 - 1) * unit;
    }
    case "tens": {
      const step = 10 * unit;
      return Math.ceil(minor / step) * step;
    }
  }
}
