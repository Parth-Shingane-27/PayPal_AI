import { describe, expect, it } from "vitest";
import { availableOf, balanceLines, holdingOf, netOnRelease, refundSplit } from "@/server/domain/balances";
import { estimatePayoutFee, FEE_TABLE } from "@/server/domain/fees";
import { invoiceLines, invoiceNumber, invoicePrefixFor, nextInvoiceSeq } from "@/server/domain/invoices";
import { formatMoney, parseDecimal, SUPPORTED_CURRENCIES, toDecimalString } from "@/server/domain/money";
import { REFERENCE_USD_RATES } from "@/server/domain/reference-rates";

describe("balances", () => {
  it("available = released - refunded - paidOut - reserved; holding is separate", () => {
    const lines = balanceLines([
      { kind: "released", currency: "USD", amountMinor: 100_000 },
      { kind: "released", currency: "USD", amountMinor: 50_000 },
      { kind: "refunded", currency: "USD", amountMinor: 10_000 },
      { kind: "paid_out", currency: "USD", amountMinor: 60_000 },
      { kind: "reserved", currency: "USD", amountMinor: 20_000 },
      { kind: "in_holding", currency: "USD", amountMinor: 999_999 },
      { kind: "in_holding", currency: "EUR", amountMinor: 30_000 },
    ]);
    expect(lines).toEqual([
      { currency: "EUR", released: 0, refunded: 0, paidOut: 0, reserved: 0, available: 0, inHolding: 30_000 },
      { currency: "USD", released: 150_000, refunded: 10_000, paidOut: 60_000, reserved: 20_000, available: 60_000, inHolding: 999_999 },
    ]);
  });

  it("money in holding never becomes available", () => {
    const [l] = balanceLines([{ kind: "in_holding", currency: "JPY", amountMinor: 50_000 }]);
    expect(l!.available).toBe(0);
    expect(availableOf({ released: 0, refunded: 0, paidOut: 0, reserved: 0 })).toBe(0);
  });

  it("rejects non-integer amounts", () => {
    expect(() => balanceLines([{ kind: "released", currency: "USD", amountMinor: 1.5 }])).toThrow();
  });
});

describe("release and refunds", () => {
  const fees = { grossMinor: 100_000, paypalFeeMinor: 3_539, platformFeeMinor: 5_000, fxCostMinor: 1_200 };

  it("net_to_freelancer = gross - PayPal fee - platform fee - FX cost", () => {
    expect(netOnRelease(fees)).toBe(100_000 - 3_539 - 5_000 - 1_200);
  });

  it("a partial refund from holding comes off the gross and returns its fees", () => {
    const net = netOnRelease(fees, [{ amountMinor: 40_000, paypalFeeReturnedMinor: 1_400, platformFeeReturnedMinor: 2_000 }]);
    expect(net).toBe(60_000 - (3_539 - 1_400) - (5_000 - 2_000) - 1_200);
    expect(() => netOnRelease(fees, [{ amountMinor: 100_001, paypalFeeReturnedMinor: 0, platformFeeReturnedMinor: 0 }])).toThrow();
  });

  it("holding shrinks with refunds and never goes negative", () => {
    expect(holdingOf(100_000, 40_000)).toBe(60_000);
    expect(holdingOf(100_000, 100_000)).toBe(0);
  });

  it("a refund from holding debits the freelancer nothing", () => {
    expect(refundSplit({ amountMinor: 50_000, grossMinor: 100_000, platformFeeMinor: 5_000, paypalFeeReturnedMinor: 1_700, fromHolding: true })).toEqual({
      platformFeeReturnedMinor: 2_500,
      freelancerDebitMinor: 0,
    });
  });

  it("a refund after release debits the freelancer the amount less returned fees", () => {
    expect(refundSplit({ amountMinor: 50_000, grossMinor: 100_000, platformFeeMinor: 5_000, paypalFeeReturnedMinor: 1_700, fromHolding: false })).toEqual({
      platformFeeReturnedMinor: 2_500,
      freelancerDebitMinor: 50_000 - 1_700 - 2_500,
    });
    expect(() => refundSplit({ amountMinor: 0, grossMinor: 1, platformFeeMinor: 0, paypalFeeReturnedMinor: 0, fromHolding: false })).toThrow();
    expect(() => refundSplit({ amountMinor: 2, grossMinor: 1, platformFeeMinor: 0, paypalFeeReturnedMinor: 0, fromHolding: false })).toThrow();
  });
});

describe("invoices", () => {
  it("numbers invoices sequentially per freelancer", () => {
    expect(invoiceNumber("PRK", 42)).toBe("GG-PRK-000042");
    expect(nextInvoiceSeq(0)).toBe(1);
    expect(nextInvoiceSeq(41)).toBe(42);
    expect(() => invoiceNumber("prk", 1)).toThrow();
    expect(() => invoiceNumber("PRK", 0)).toThrow();
    expect(() => nextInvoiceSeq(-1)).toThrow();
  });

  it("derives a prefix from the name", () => {
    expect(invoicePrefixFor("Priya Raman Krishnan")).toBe("PRK");
    expect(invoicePrefixFor("Jonas Weber")).toBe("JW");
    expect(invoicePrefixFor("Müller")).toBe("MUL");
    expect(invoicePrefixFor("山田")).toBe("GG");
  });

  it("lists the milestone and refund credits, and calculates no tax", () => {
    const inv = invoiceLines({ contractTitle: "Brand identity", milestoneTitle: "Logo concepts", position: 1, grossMinor: 50_000, refundsMinor: [10_000] });
    expect(inv).toEqual({
      lines: [
        { kind: "milestone", description: "Brand identity: milestone 1, Logo concepts", amount_minor: 50_000 },
        { kind: "refund", description: "Refund", amount_minor: -10_000 },
      ],
      total_minor: 40_000,
    });
    expect(inv.lines.every((l) => l.kind === "milestone" || l.kind === "refund")).toBe(true);
    expect(() => invoiceLines({ contractTitle: "x", milestoneTitle: "y", position: 1, grossMinor: 100, refundsMinor: [101] })).toThrow();
  });
});

describe("freelancer home currencies", () => {
  it("supports BRL and PHP end to end", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(expect.arrayContaining(["BRL", "PHP"]));
    expect(parseDecimal("1234.50", "BRL")).toBe(123_450);
    expect(toDecimalString(150_000, "PHP")).toBe("1500.00");
    expect(formatMoney(123_450, "BRL", "pt-BR")).toMatch(/1\.234,50/);
    for (const c of SUPPORTED_CURRENCIES) {
      expect(FEE_TABLE.fixed_fee_minor[c], c).toBeGreaterThan(0);
      expect(REFERENCE_USD_RATES[c], c).toBeGreaterThan(0);
    }
    expect(estimatePayoutFee(10_000_000, "PHP")).toBe(FEE_TABLE.payout_fee_cap_minor.PHP);
  });
});
