import { describe, expect, it } from "vitest";
import { amountAppearsIn, anchorFor, convertDecimalToMinor, normalizeUrl, numbersIn, positionOf, priceStats } from "@/server/domain/market-prices";
import { suggestPrice } from "@/server/domain/pricing";

describe("priceStats", () => {
  it("returns null for no usable prices", () => {
    expect(priceStats([])).toBeNull();
    expect(priceStats([0, -5])).toBeNull();
  });

  it("handles a single price", () => {
    expect(priceStats([2500])).toEqual({ count: 1, outliers: 0, low: 2500, p25: 2500, median: 2500, p75: 2500, high: 2500 });
  });

  it("computes quartiles over sorted prices", () => {
    const s = priceStats([3000, 1000, 2000, 4000, 5000])!;
    expect(s).toMatchObject({ count: 5, outliers: 0, low: 1000, p25: 2000, median: 3000, p75: 4000, high: 5000 });
  });

  it("drops far outliers once there are four or more prices", () => {
    // A 6-pack priced as one unit, or a luxury edition, must not move the range.
    const s = priceStats([2400, 2500, 2600, 2800, 2900, 30000])!;
    expect(s.outliers).toBe(1);
    expect(s.high).toBe(2900);
    expect(s.count).toBe(5);
  });

  it("anchors positioning on the quartiles", () => {
    const s = priceStats([1000, 2000, 3000, 4000, 5000])!;
    expect(anchorFor(s, "competitive")).toBe(2000);
    expect(anchorFor(s, "market")).toBe(3000);
    expect(anchorFor(s, "premium")).toBe(4000);
  });
});

describe("positionOf", () => {
  const observed = [1000, 2000, 3000, 4000, 5000];
  const s = priceStats(observed)!;
  it("places prices against the range", () => {
    expect(positionOf(900, s, observed)).toEqual({ position: "BELOW_MARKET", cheaper_offers_percent: 0 });
    expect(positionOf(2500, s, observed)).toEqual({ position: "LOWER_HALF", cheaper_offers_percent: 40 });
    expect(positionOf(3500, s, observed)).toEqual({ position: "UPPER_HALF", cheaper_offers_percent: 60 });
    expect(positionOf(6000, s, observed)).toEqual({ position: "ABOVE_MARKET", cheaper_offers_percent: 100 });
  });
});

describe("price evidence", () => {
  it("reads prices the way shops write them", () => {
    const n = numbersIn("Preis 25,00 € · was 1.299,00 € · $18.00 · ¥1,290 · ₹ 1 499 · 12 990 Ft");
    for (const v of [25, 1299, 18, 1290, 1499, 12990]) expect(n.has(v)).toBe(true);
  });

  it("confirms a reported amount only if it is on the page", () => {
    expect(amountAppearsIn("25.00", "Tasse mit Spots ... 25,00 € inkl. MwSt.")).toBe(true);
    expect(amountAppearsIn("18", "Regular price $18.00 Sale price $18.00")).toBe(true);
    expect(amountAppearsIn("1290", "価格 ¥1,290 (税込)")).toBe(true);
    expect(amountAppearsIn("24.99", "Regular price $18.00")).toBe(false);
    expect(amountAppearsIn("0", "0")).toBe(false);
  });

  it("normalises URLs for matching", () => {
    expect(normalizeUrl("https://www.Etsy.com/listing/123/mug/?ref=abc#x")).toBe("etsy.com/listing/123/mug");
    expect(normalizeUrl("http://etsy.com/listing/123/mug")).toBe("etsy.com/listing/123/mug");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("converts any currency's decimal amount into minor units", () => {
    expect(convertDecimalToMinor("1499", 0.012, 2)).toBe(1799); // INR -> USD cents
    expect(convertDecimalToMinor("25.00", 160, 0)).toBe(4000); // EUR -> JPY
  });
});

describe("suggestPrice with a market anchor", () => {
  const sale = { currency: "EUR", marketCountry: "DE", sellerCountry: "DE", sellerCurrency: "EUR", platformBps: 500 };
  it("aims at the anchor when it is above the margin floor", () => {
    const r = suggestPrice({ landedCostMinor: 1000, marginBps: 3000, rounding: "x99", sale, marketAnchorMinor: 3450 });
    expect(r.strategy).toBe("MARKET_ANCHOR");
    expect(r.price_minor).toBe(3499);
    expect(r.warnings).toEqual([]);
  });

  it("never goes below the margin floor", () => {
    const r = suggestPrice({ landedCostMinor: 3000, marginBps: 3000, rounding: "x99", sale, marketAnchorMinor: 2000 });
    expect(r.strategy).toBe("MARGIN_FLOOR");
    expect(r.price_minor).toBeGreaterThanOrEqual(r.floor_price_minor);
    expect(r.warnings).not.toContain("BELOW_TARGET_MARGIN");
  });

  it("lets an explicit competitor range win over the anchor", () => {
    const r = suggestPrice({ landedCostMinor: 1000, marginBps: 3000, rounding: "x99", sale, competitor: { lowMinor: 5000, highMinor: 6000 }, marketAnchorMinor: 3000 });
    expect(r.strategy).toBe("COMPETITOR_LOW");
  });
});
