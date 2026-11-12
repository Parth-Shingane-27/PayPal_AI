import { describe, expect, it } from "vitest";
import type { SaleContext } from "@/server/domain/fees";
import { chooseRate, estimatedNet, FLOOR_PLUS_BPS, floorPrice } from "@/server/domain/rates";

const de: SaleContext = { currency: "EUR", marketCountry: "DE", freelancerCountry: "IN", freelancerCurrency: "USD", platformBps: 500 };
const jp: SaleContext = { currency: "JPY", marketCountry: "JP", freelancerCountry: "JP", freelancerCurrency: "JPY", platformBps: 500 };

describe("floorPrice", () => {
  it("is the lowest price point whose estimated net covers the floor", () => {
    for (const [ctx, rounding, net] of [
      [de, "x99", 12_000],
      [de, "x99", 1],
      [jp, "tens", 36_000],
      [{ ...de, currency: "USD", marketCountry: "IN", freelancerCountry: "IN" }, "x99", 5_000],
    ] as const) {
      const p = floorPrice(net, ctx, rounding);
      expect(estimatedNet(p, ctx), `${ctx.currency} ${net}`).toBeGreaterThanOrEqual(net);
      // One price point lower would not cover it (x99: the previous .99; tens: 10 yen less).
      const lower = rounding === "tens" ? p - 10 : p - 100;
      if (lower > 0) expect(estimatedNet(lower, ctx)).toBeLessThan(net);
    }
  });

  it("rejects a non-positive floor", () => {
    expect(() => floorPrice(0, de, "x99")).toThrow();
    expect(() => floorPrice(1.5, de, "x99")).toThrow();
  });
});

describe("chooseRate", () => {
  const base = { rounding: "x99" as const, currency: "EUR" };

  it("never goes below the floor", () => {
    expect(chooseRate({ ...base, floor: 20_099, target: 9_000 })).toEqual({ price: 20_099, strategy: "floor", raisedToFloor: true });
    for (let target = 1; target < 60_000; target += 997) {
      expect(chooseRate({ ...base, floor: 20_099, target }).price).toBeGreaterThanOrEqual(20_099);
    }
  });

  it("aims at the target when it is above the floor", () => {
    expect(chooseRate({ ...base, floor: 10_099, target: 30_000 })).toEqual({ price: 30_099, strategy: "target", raisedToFloor: false });
  });

  it("adds a margin over the floor when there is no target", () => {
    const r = chooseRate({ ...base, floor: 10_099, target: null });
    expect(r.strategy).toBe("floor_plus");
    expect(r.price).toBeGreaterThanOrEqual(Math.round(10_099 * (1 + FLOOR_PLUS_BPS / 10_000)));
  });
});
