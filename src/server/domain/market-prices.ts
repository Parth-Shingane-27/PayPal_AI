/**
 * Pure maths for market price research: summary statistics over observed
 * prices, where a price sits in that market, and checking that a price the
 * model reported really appears on the page it came from. No I/O here.
 */

export type PriceStats = {
  /** Offers the statistics are computed from (after outliers are dropped). */
  count: number;
  /** Offers dropped as outliers (far outside the middle half). */
  outliers: number;
  low: number;
  p25: number;
  median: number;
  p75: number;
  high: number;
};

/** Linear-interpolated percentile of sorted integers, rounded to a whole minor unit. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo));
}

/**
 * Statistics over prices in minor units. With four or more prices, values
 * outside 1.5 × IQR of the quartiles are dropped first (a 6-pack priced as one
 * mug, a luxury edition), so one odd offer cannot move the range.
 */
export function priceStats(pricesMinor: number[]): PriceStats | null {
  const clean = pricesMinor.filter((p) => Number.isSafeInteger(p) && p > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  let kept = clean;
  if (clean.length >= 4) {
    const q1 = percentile(clean, 0.25);
    const q3 = percentile(clean, 0.75);
    const fence = 1.5 * (q3 - q1);
    kept = clean.filter((p) => p >= q1 - fence && p <= q3 + fence);
  }
  return {
    count: kept.length,
    outliers: clean.length - kept.length,
    low: kept[0]!,
    p25: percentile(kept, 0.25),
    median: percentile(kept, 0.5),
    p75: percentile(kept, 0.75),
    high: kept[kept.length - 1]!,
  };
}

export type Positioning = "competitive" | "market" | "premium";

/** The observed price a positioning aims for: lower quartile, median or upper quartile. */
export function anchorFor(stats: PriceStats, positioning: Positioning): number {
  switch (positioning) {
    case "competitive":
      return stats.p25;
    case "market":
      return stats.median;
    case "premium":
      return stats.p75;
  }
}

export type MarketPosition = "BELOW_MARKET" | "LOWER_HALF" | "UPPER_HALF" | "ABOVE_MARKET";

/** Where a price sits against observed prices, plus the share of offers cheaper than it. */
export function positionOf(priceMinor: number, stats: PriceStats, observed: number[]): { position: MarketPosition; cheaper_offers_percent: number } {
  const position: MarketPosition =
    priceMinor < stats.low ? "BELOW_MARKET" : priceMinor > stats.high ? "ABOVE_MARKET" : priceMinor <= stats.median ? "LOWER_HALF" : "UPPER_HALF";
  const cheaper = observed.length ? Math.round((observed.filter((p) => p < priceMinor).length * 100) / observed.length) : 0;
  return { position, cheaper_offers_percent: cheaper };
}

/**
 * Every number written in `text`, read both ways a shop might write it
 * ("1,299.00" and "1.299,00"; "25,00" and "25.00"). Used to confirm a price
 * the model reported is really on the source page.
 */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d[\d.,'   ]*\d|\d/g)) {
    const raw = m[0].replace(/[   ']/g, "");
    // Decimal comma: "25,00", "1.299,00"
    if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(raw) || /^\d+,\d{1,2}$/.test(raw)) out.add(Number(raw.replace(/\./g, "").replace(",", ".")));
    // Decimal point: "25.00", "1,299.00"
    if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(raw) || /^\d+\.\d{1,2}$/.test(raw)) out.add(Number(raw.replace(/,/g, "")));
    // Whole numbers with thousands separators: "1,299", "1.299", "12 990"
    if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) out.add(Number(raw.replace(/[.,]/g, "")));
    if (/^\d+$/.test(raw)) out.add(Number(raw));
  }
  return out;
}

/** True if `amount` (a decimal string like "25.00") appears as a number in `text`. */
export function amountAppearsIn(amount: string, text: string): boolean {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return false;
  for (const n of numbersIn(text)) if (Math.abs(n - value) < 0.005) return true;
  return false;
}

/**
 * Converts a decimal amount in any currency (including ones GlobalGig does
 * not sell in, like INR) to minor units of `toExponent`, rounded half up.
 */
export function convertDecimalToMinor(amount: string, rate: number, toExponent: number): number {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Bad amount ${amount}`);
  return Math.round(value * rate * 10 ** toExponent);
}

/** URL normalised for matching: no scheme, "www.", query, fragment or trailing slash; lower-case host. */
export function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
