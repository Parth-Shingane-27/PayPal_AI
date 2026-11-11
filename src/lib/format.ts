/**
 * Pure display helpers shared by grids, charts and pages. Dates are always
 * formatted in UTC with an explicit locale so server and client render the
 * same text (no hydration mismatch).
 */

export type MoneyLike = { amount_minor: number; currency: string; display: string };

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const dateFormats = new Map<string, Intl.DateTimeFormat>();
/** "04 Nov 2026" (or the locale's equivalent), always in UTC. */
export const formatDate = (iso: string | null | undefined, locale = "en-GB") => {
  if (!iso) return "";
  if (locale === "en-GB") return SHORT_DATE.format(new Date(iso));
  let f = dateFormats.get(locale);
  if (!f) dateFormats.set(locale, (f = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })));
  return f.format(new Date(iso));
};
export const formatDay = (iso: string, locale = "en-GB") =>
  locale === "en-GB" ? SHORT_DAY.format(new Date(iso)) : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** "2026-06" -> "Jun" */
export const formatMonthKey = (key: string, locale = "en-GB") =>
  (locale === "en-GB" ? MONTH : new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })).format(new Date(`${key}-01T00:00:00Z`));
export const formatMonthYear = (key: string, locale = "en-GB") =>
  (locale === "en-GB" ? MONTH_YEAR : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })).format(new Date(`${key}-01T00:00:00Z`));

/** Basis points as a percentage: 1234 -> "12.3%". */
export function formatBps(bps: number | null | undefined, digits = 1): string {
  if (bps === null || bps === undefined) return "";
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Signed change in basis points: 1250 -> "+12.5%", -300 -> "−3.0%". */
export function formatChange(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "";
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "±";
  return `${sign}${(Math.abs(bps) / 100).toFixed(1)}%`;
}

/**
 * The part of an id a person can tell orders apart by. UUIDv7 ids start with a
 * timestamp, so ids created together share their first 8 characters; the tail is the random part.
 */
export const shortId = (id: string): string => id.slice(-8);

export const formatCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** Relative age for message lists: "just now", "5 min", "3 h", "2 d", else a date. */
export function formatAge(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return formatDay(iso);
}

/** Sort money by minor units; mixed currencies sort by currency first so the order is stable. */
export function compareMoney(a: MoneyLike | null | undefined, b: MoneyLike | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
  return a.amount_minor - b.amount_minor;
}

/** Plain decimal for CSV export ("1234.50 EUR", "7980 JPY"). */
export function moneyCsv(m: MoneyLike | null | undefined): string {
  if (!m) return "";
  const exp = m.currency === "JPY" ? 0 : 2;
  return `${(m.amount_minor / 10 ** exp).toFixed(exp)} ${m.currency}`;
}

export const LANGUAGE_OF: Record<string, string> = {
  "en-US": "English",
  "en-GB": "English",
  "en-CA": "English",
  "en-AU": "English",
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "es-MX": "Spanish",
  "it-IT": "Italian",
  "ja-JP": "Japanese",
  "hi-IN": "Hindi",
};

export const COUNTRY_LABEL: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  MX: "Mexico",
  JP: "Japan",
  IN: "India",
};
