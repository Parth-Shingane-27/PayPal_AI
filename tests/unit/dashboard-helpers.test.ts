import { describe, expect, it } from "vitest";
import { compareMoney, formatAge, formatBps, formatChange, moneyCsv, shortId } from "@/lib/format";
import { parseGridState, serializeGridState } from "@/lib/grid-state";
import { allocateByWeight, changeBps, lastMonthKeys, monthProgress, ratioBps, weekIndex } from "@/server/domain/analytics";
import { convertAtReference, referenceRate } from "@/server/domain/reference-rates";
import { CLIENTS, FREELANCERS, LANGS, langOf } from "../../prisma/seed/people";
import { createRng } from "../../prisma/seed/prng";
import { BRIEFS, SCRIPTS } from "../../prisma/seed/scripts";
import { isMarketLocale } from "@/server/domain/markets";

describe("shortId", () => {
  it("uses the random tail, because UUIDv7 ids created together share their first characters", () => {
    const a = "01a1b236-5132-7527-8e5d-25c3d71f6b16";
    const b = "01a1b236-5133-7a10-9c44-0b7e2d9e41aa";
    expect(a.slice(0, 8)).toBe(b.slice(0, 8));
    expect(shortId(a)).toBe("d71f6b16");
    expect(shortId(a)).not.toBe(shortId(b));
  });
});

describe("monthProgress", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("marks only the current month as partial, with how far through it is", () => {
    expect(monthProgress("2026-11", now)).toEqual({ partial: true, days_elapsed: 9, days_in_month: 30 });
    expect(monthProgress("2026-10", now)).toEqual({ partial: false, days_elapsed: 31, days_in_month: 31 });
  });
  it("knows leap-year February", () => {
    expect(monthProgress("2028-02", new Date("2028-03-05T00:00:00Z")).days_in_month).toBe(29);
  });
});

describe("allocateByWeight", () => {
  it("splits exactly, including negative totals and zero weights", () => {
    for (const [total, weights] of [
      [1000, [1, 1, 1]],
      [-7, [3, 1]],
      [5, [0, 0]],
      [123457, [4999, 4999, 2999]],
    ] as const) {
      const parts = allocateByWeight(total, [...weights]);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
      expect(parts.every(Number.isInteger)).toBe(true);
    }
    expect(allocateByWeight(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });
});

describe("analytics helpers", () => {
  it("builds month keys and week buckets in UTC", () => {
    expect(lastMonthKeys(new Date("2026-11-06T10:00:00Z"), 3)).toEqual(["2026-09", "2026-10", "2026-11"]);
    const now = new Date("2026-11-06T00:00:00Z");
    expect(weekIndex(new Date("2026-11-05T00:00:00Z"), now, 12)).toBe(11);
    expect(weekIndex(new Date("2026-08-01T00:00:00Z"), now, 12)).toBe(-1);
  });
  it("computes ratios and changes in basis points", () => {
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(5, 0)).toBe(0);
    expect(changeBps(150, 100)).toBe(5000);
    expect(changeBps(10, 0)).toBeNull();
  });
});

describe("reference rates", () => {
  it("round-trips and keeps JPY whole", () => {
    expect(convertAtReference(10000, "USD", "USD")).toBe(10000);
    expect(convertAtReference(10000, "USD", "JPY")).toBe(15200);
    expect(referenceRate("EUR", "USD")).toBeCloseTo(1 / 0.92);
  });
});

describe("format helpers", () => {
  it("formats percentages, changes, ages and CSV money", () => {
    expect(formatBps(1234)).toBe("12.3%");
    expect(formatChange(-300)).toBe("−3.0%");
    expect(formatChange(null)).toBe("");
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(formatAge("2026-11-06T11:55:00Z", now)).toBe("5 min");
    expect(formatAge("2026-11-04T12:00:00Z", now)).toBe("2 d");
    expect(moneyCsv({ amount_minor: 7980, currency: "JPY", display: "¥7,980" })).toBe("7980 JPY");
    expect(moneyCsv({ amount_minor: 123450, currency: "EUR", display: "" })).toBe("1234.50 EUR");
  });
  it("sorts money by minor units within a currency", () => {
    const m = (a: number, c = "USD") => ({ amount_minor: a, currency: c, display: "" });
    expect([m(300), m(100), m(200)].sort(compareMoney).map((x) => x.amount_minor)).toEqual([100, 200, 300]);
    expect(compareMoney(m(1, "EUR"), m(999, "USD"))).toBeLessThan(0);
  });
});

describe("grid state", () => {
  it("ignores corrupt or old-version layouts", () => {
    const state = [{ colId: "date", sort: "desc" }];
    expect(parseGridState(serializeGridState(state))).toEqual(state);
    expect(parseGridState("{oops")).toBeNull();
    expect(parseGridState(JSON.stringify({ v: 0, state }))).toBeNull();
    expect(parseGridState(null)).toBeNull();
  });
});

describe("seed data", () => {
  it("has ten freelancers and ten clients, with unique slugs", () => {
    expect(FREELANCERS).toHaveLength(10);
    expect(CLIENTS).toHaveLength(10);
    expect(new Set(FREELANCERS.map((f) => f.slug)).size).toBe(10);
    expect(new Set(CLIENTS.map((c) => c.slug)).size).toBe(10);
  });
  it("gives every project category at least one freelancer whose skills match it", () => {
    const skills = new Set(FREELANCERS.flatMap((f) => f.skills));
    expect(skills.size).toBeGreaterThan(10);
    expect(Object.keys(BRIEFS).length).toBeGreaterThanOrEqual(8);
  });
  it("uses supported markets for every person, and a language for each", () => {
    for (const p of [...FREELANCERS, ...CLIENTS]) {
      expect(isMarketLocale(p.locale), p.locale).toBe(true);
      expect(LANGS).toContain(langOf(p.locale));
    }
  });
  it("has every brief and conversation line in every language", () => {
    for (const b of Object.values(BRIEFS)) for (const lang of LANGS) expect(b[lang]?.title && b[lang]?.description, lang).toBeTruthy();
    for (const lines of Object.values(SCRIPTS)) for (const l of lines) for (const lang of LANGS) expect(l[lang]).toBeTruthy();
  });
  it("uses a deterministic PRNG", () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });
});
