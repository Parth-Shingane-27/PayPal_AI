import { describe, expect, it } from "vitest";
import { estimatePayoutFee, estimateSaleFees, maxPayoutFor, payoutFeeCapThreshold, type SaleContext } from "@/server/domain/fees";
import { getMarket, listMarkets, roundUpToPricePoint } from "@/server/domain/markets";
import { applyBps, convertMinor, formatMoney, parseDecimal, toDecimalString } from "@/server/domain/money";

describe("money", () => {
  it("formats and converts minor units", () => {
    expect(toDecimalString(4999, "USD")).toBe("49.99");
    expect(toDecimalString(5, "EUR")).toBe("0.05");
    expect(toDecimalString(7980, "JPY")).toBe("7980");
    expect(formatMoney(7980, "JPY", "ja-JP")).toMatch(/7,980/);
    expect(formatMoney(4999, "USD", "en-US")).toBe("$49.99");
  });

  it("parses decimals strictly", () => {
    expect(parseDecimal("12.3", "USD")).toBe(1230);
    expect(parseDecimal("1200", "JPY")).toBe(1200);
    expect(() => parseDecimal("12.345", "USD")).toThrow(/at most 2/);
    expect(() => parseDecimal("12.5", "JPY")).toThrow(/at most 0/);
    expect(() => parseDecimal("1e3", "USD")).toThrow();
    expect(() => parseDecimal("10", "INR")).toThrow(/Unsupported/);
  });

  it("rounds bps and conversions half up", () => {
    expect(applyBps(1000, 349)).toBe(35);
    expect(applyBps(4999, 500)).toBe(250);
    expect(convertMinor(2700, "USD", "JPY", 150.5)).toBe(4064);
    expect(convertMinor(4064, "JPY", "USD", 1 / 150.5)).toBe(2700);
  });
});

describe("markets", () => {
  it("covers the 11 markets with the agreed currencies", () => {
    expect(listMarkets()).toHaveLength(11);
    expect(getMarket("hi-IN").currency).toBe("USD");
    expect(getMarket("ja-JP")).toMatchObject({ currency: "JPY", rounding: "tens" });
    expect(getMarket("es-MX")).toMatchObject({ currency: "MXN", rounding: "ends9" });
    expect(() => getMarket("xx-XX")).toThrow();
  });
});

describe("price points", () => {
  it("rounds up to x.99", () => {
    expect(roundUpToPricePoint(1234, "x99", "USD")).toBe(1299);
    expect(roundUpToPricePoint(1299, "x99", "USD")).toBe(1299);
    expect(roundUpToPricePoint(1300, "x99", "USD")).toBe(1399);
  });
  it("rounds MXN up to whole units ending in 9", () => {
    expect(roundUpToPricePoint(12345, "ends9", "MXN")).toBe(12900);
    expect(roundUpToPricePoint(12900, "ends9", "MXN")).toBe(12900);
    expect(roundUpToPricePoint(12901, "ends9", "MXN")).toBe(13900);
  });
  it("rounds JPY up to multiples of 10", () => {
    expect(roundUpToPricePoint(1234, "tens", "JPY")).toBe(1240);
    expect(roundUpToPricePoint(1240, "tens", "JPY")).toBe(1240);
  });
});

const usDomestic: SaleContext = { currency: "USD", marketCountry: "US", freelancerCountry: "US", freelancerCurrency: "USD", platformBps: 500 };
const deToJapan: SaleContext = { currency: "JPY", marketCountry: "JP", freelancerCountry: "DE", freelancerCurrency: "EUR", platformBps: 500 };

describe("fee estimates", () => {
  it("adds international and conversion only when they apply", () => {
    const dom = estimateSaleFees(10000, usDomestic);
    expect(dom).toMatchObject({ paypal_fee: 349 + 49, international_fee: 0, conversion_cost: 0, platform_fee: 500 });
    const intl = estimateSaleFees(10000, deToJapan);
    expect(intl).toMatchObject({ paypal_fee: 349 + 40, international_fee: 150, conversion_cost: 300, platform_fee: 500 });
    expect(intl.net_to_freelancer).toBe(10000 - intl.total_fees);
  });

  it("caps the payout fee", () => {
    expect(estimatePayoutFee(10000, "USD")).toBe(200);
    expect(estimatePayoutFee(1_000_000, "USD")).toBe(2000);
    expect(payoutFeeCapThreshold("USD")).toBe(100_000);
  });

  it("finds the largest payout that fits the balance", () => {
    for (const available of [0, 1, 102, 10_000, 99_999, 102_000, 500_000]) {
      const amount = maxPayoutFor(available, "USD");
      expect(amount + estimatePayoutFee(amount, "USD")).toBeLessThanOrEqual(available);
      expect(amount + 1 + estimatePayoutFee(amount + 1, "USD")).toBeGreaterThan(available);
    }
  });
});
