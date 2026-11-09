/**
 * Delivery estimate for a paid order. Deterministic and labelled an estimate:
 * the seller needs 2 business days to hand the parcel over, then transit takes
 * 2-5 business days inside one country or 5-10 across borders.
 */

const HANDLING_DAYS = 2;
const DOMESTIC_TRANSIT: [number, number] = [2, 5];
const INTERNATIONAL_TRANSIT: [number, number] = [5, 10];

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

export type DeliveryEstimate = {
  earliest: string;
  latest: string;
  /** e.g. "Mon, Nov 16 to Fri, Nov 20, 2026". */
  display: string;
  international: boolean;
  is_estimate: true;
};

export function estimateDelivery(sellerCountry: string, buyerCountry: string, paidAt: Date, locale = "en-US"): DeliveryEstimate {
  const international = sellerCountry !== buyerCountry;
  const [min, max] = international ? INTERNATIONAL_TRANSIT : DOMESTIC_TRANSIT;
  const earliest = addBusinessDays(paidAt, HANDLING_DAYS + min);
  const latest = addBusinessDays(paidAt, HANDLING_DAYS + max);
  const short = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const full = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return {
    earliest: earliest.toISOString().slice(0, 10),
    latest: latest.toISOString().slice(0, 10),
    display: `${short.format(earliest)} to ${full.format(latest)}`,
    international,
    is_estimate: true,
  };
}
