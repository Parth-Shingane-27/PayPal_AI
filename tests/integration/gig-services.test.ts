import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "@/server/config";
import { prisma } from "@/server/db";
import { estimateSaleFees, type SaleContext } from "@/server/domain/fees";
import { priceStats } from "@/server/domain/market-prices";
import { closeQueues } from "@/server/queue";
import { createService, publishServicePage, saveServicePageDraft, unpublishServicePage } from "@/server/services/gig/catalog";
import { detectFreelancerAnomalies, earningsBy, forecastFreelancerEarnings } from "@/server/services/gig/insights";
import { suggestRate } from "@/server/services/gig/rates";
import { compareServicePages, searchFreelancers } from "@/server/services/gig/search";
import { resolvePeriod } from "@/server/domain/period";
import { makeClient, makeContract, makeFreelancer, makeService, makeServicePage, resetDb } from "../helpers/db";
import { fakeFx } from "../helpers/fakes";

beforeEach(resetDb);
afterAll(closeQueues);

const DAY = 86_400_000;
const noEmbed = { embed: async () => Promise.reject(new ConfigError("Voyage", [])) };

describe("catalog", () => {
  it("creates a service with floor base prices, and refuses bad shapes and duplicate codes", async () => {
    const f = await makeFreelancer({ hourly_floor_minor: 4_000 });
    const s = await createService(f.id, {
      code: "logo",
      title: "Logo design",
      description: "Vector logos for small businesses.",
      source_locale: "en-US",
      category: "Design",
      pricing_model: "PACKAGES",
      packages: [
        { tier: "BASIC", scope: "Two concepts", delivery_days: 3, revisions: 1, estimated_hours: 2 },
        { tier: "STANDARD", scope: "Four concepts", delivery_days: 5, revisions: 2, estimated_hours: 5 },
      ],
    });
    expect(s).toMatchObject({ code: "LOGO", currency: "USD", pricing_model: "PACKAGES" });
    expect(s.packages.map((p) => [p.tier, p.base_price_minor]).sort()).toEqual([["BASIC", 8_000], ["STANDARD", 20_000]]);

    const base = { title: "x service", description: "a long enough description", source_locale: "en-US" as const, category: "Design" };
    await expect(createService(f.id, { ...base, code: "LOGO", pricing_model: "HOURLY" })).rejects.toThrow(/already have a service/);
    await expect(createService(f.id, { ...base, code: "H1", pricing_model: "HOURLY", packages: [{ tier: "BASIC", scope: "abc", delivery_days: 1, revisions: 0, estimated_hours: 1 }] })).rejects.toThrow();
    await expect(createService(f.id, { ...base, code: "P1", pricing_model: "PACKAGES", packages: [] })).rejects.toThrow();
    const hourly = await createService(f.id, { ...base, code: "H2", pricing_model: "HOURLY" });
    expect(hourly.hourly_rate_minor).toBe(4_000);
  });

  it("saves page drafts, moves a published page back to DRAFT, and checks SEO length, prices and owner", async () => {
    const f = await makeFreelancer();
    const svc = await makeService(f.id);
    const prices = svc.packages.map((p) => ({ packageId: p.id, priceMinor: 20_000 }));
    const draft = { serviceId: svc.id, locale: "de-DE", title: "Logodesign", description: "Ein Logo.", seoTitle: "Logodesign", prices, hourlyRateMinor: null, pricing: null };
    const page = await saveServicePageDraft(f.id, draft);
    expect(page).toMatchObject({ status: "DRAFT", currency: "EUR", locale: "de-DE" });
    expect(page.prices).toHaveLength(3);

    await publishServicePage(f.id, page.id);
    expect((await prisma.servicePage.findUniqueOrThrow({ where: { id: page.id } })).status).toBe("PUBLISHED");
    const again = await saveServicePageDraft(f.id, { ...draft, title: "Logodesign neu" });
    expect(again).toMatchObject({ id: page.id, status: "DRAFT", published_at: null, title: "Logodesign neu" });

    await expect(saveServicePageDraft(f.id, { ...draft, seoTitle: "x".repeat(71) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(saveServicePageDraft(f.id, { ...draft, prices: prices.slice(0, 2) })).rejects.toThrow(/every package/);
    await expect(saveServicePageDraft(f.id, { ...draft, locale: "xx-XX" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const eve = await makeFreelancer();
    await expect(saveServicePageDraft(eve.id, draft)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(unpublishServicePage(eve.id, page.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("publishes only a page with every package priced", async () => {
    const f = await makeFreelancer();
    const svc = await makeService(f.id);
    const partial = await makeServicePage(svc, { status: "DRAFT", prices: { BASIC: 10_000 } });
    await expect(publishServicePage(f.id, partial.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await makeFreelancer();
    await expect(publishServicePage(other.id, partial.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("suggestRate", () => {
  const fx = fakeFx({ "USD->EUR": 0.9 });
  const ctx: SaleContext = { currency: "EUR", marketCountry: "DE", freelancerCountry: "US", freelancerCurrency: "USD", platformBps: 500 };

  async function world(observed: number[] | null) {
    const f = await makeFreelancer({ hourly_floor_minor: 4_000, country: "US", currency: "USD" });
    const svc = await makeService(f.id);
    if (observed) {
      const stats = priceStats(observed)!;
      await prisma.marketRateResearch.create({
        data: {
          freelancer_id: f.id,
          service_id: svc.id,
          locale: "de-DE",
          currency: "EUR",
          offer_count: observed.length,
          result: { currency: "EUR", unit: "project", stats, observed_minor: observed, researched_at: new Date().toISOString() },
        },
      });
    }
    return { f, svc };
  }

  /** Every suggested price nets at least floor x hours (converted at 0.9). */
  function assertAboveFloor(items: { estimated_hours: number | null; suggested_price: { amount_minor: number }; floor_price: { amount_minor: number } }[]) {
    for (const i of items) {
      expect(i.suggested_price.amount_minor).toBeGreaterThanOrEqual(i.floor_price.amount_minor);
      expect(estimateSaleFees(i.suggested_price.amount_minor, ctx).net_to_freelancer).toBeGreaterThanOrEqual(Math.round((i.estimated_hours ?? 1) * 4_000 * 0.9));
    }
  }

  it("aims at the market and scales packages by hours", async () => {
    const { f, svc } = await world([30_000, 40_000, 50_000, 60_000, 70_000]);
    const q = await suggestRate(f.id, { serviceId: svc.id, locale: "de-DE", positioning: "market" }, fx);
    expect(q).toMatchObject({ market: "de-DE", currency: "EUR", unit: "package", positioning: "market", market_range: { median: { amount_minor: 50_000 } } });
    const by = Object.fromEntries(q.items.map((i) => [i.tier, i]));
    expect(by.STANDARD).toMatchObject({ strategy: "market", suggested_price: { amount_minor: 50_099 } });
    expect(by.BASIC!.suggested_price.amount_minor).toBe(25_099);
    expect(by.PREMIUM!.suggested_price.amount_minor).toBe(100_099);
    assertAboveFloor(q.items);
    expect(q.warnings).toEqual([]);
  });

  it("never goes below the floor: a cheap market is raised to it with a warning", async () => {
    const { f, svc } = await world([1_000, 1_200, 1_500, 1_800]);
    const q = await suggestRate(f.id, { serviceId: svc.id, locale: "de-DE", positioning: "competitive" }, fx);
    for (const i of q.items) expect(i).toMatchObject({ strategy: "floor", suggested_price: { amount_minor: i.floor_price.amount_minor } });
    assertAboveFloor(q.items);
    expect(q.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["FLOOR_ABOVE_MARKET", "ABOVE_MARKET_RANGE"]));
  });

  it("raises a target below the floor, and says when there is no research", async () => {
    const { f, svc } = await world(null);
    const target = await suggestRate(f.id, { serviceId: svc.id, locale: "de-DE", targetPrice: "10" }, fx);
    expect(target.warnings.map((w) => w.code)).toContain("TARGET_BELOW_FLOOR");
    assertAboveFloor(target.items);
    const blind = await suggestRate(f.id, { serviceId: svc.id, locale: "de-DE", positioning: "market" }, fx);
    expect(blind.warnings.map((w) => w.code)).toEqual(["NO_MARKET_DATA"]);
    expect(blind.items.every((i) => i.strategy === "floor_plus")).toBe(true);
    await expect(suggestRate((await makeFreelancer()).id, { serviceId: svc.id, locale: "de-DE" }, fx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("prices an hourly service as one hourly rate", async () => {
    const f = await makeFreelancer({ hourly_floor_minor: 4_000 });
    const svc = await createService(f.id, { code: "HR", title: "React help", description: "Hourly React development.", source_locale: "en-US", category: "Development", pricing_model: "HOURLY" });
    const q = await suggestRate(f.id, { serviceId: svc.id, locale: "de-DE" }, fx);
    expect(q.unit).toBe("hour");
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ tier: null, package_id: null, estimated_hours: null, strategy: "floor_plus" });
    assertAboveFloor(q.items);
  });
});

describe("search", () => {
  it("falls back to keywords without embeddings, in the client's market only", async () => {
    const designer = await makeFreelancer({ skills: ["logo design"] });
    const translator = await makeFreelancer({ skills: ["german translation"] });
    const logo = await makeServicePage(await makeService(designer.id), { locale: "de-DE", title: "Logodesign", description: "Ein Logo für Ihre Marke." });
    await makeServicePage(await makeService(translator.id, { title: "Translation" }), { locale: "de-DE", title: "Technische Übersetzung", description: "Handbücher übersetzen." });
    await makeServicePage(await makeService(designer.id, { code: "DRAFT-1" }), { locale: "de-DE", title: "Logo drafts", status: "DRAFT" });
    await makeServicePage(await makeService(designer.id, { code: "US-1" }), { locale: "en-US", title: "Logo design US" });

    const r = await searchFreelancers("de-DE", "logo", 6, noEmbed);
    expect(r.mode).toBe("keyword");
    expect(r.results.map((x) => x.service_page_id)).toEqual([logo.id]);
    expect(r.results[0]).toMatchObject({ freelancer_id: designer.id, from_price: { currency: "EUR" } });
    await expect(searchFreelancers("de-DE", "  ", 6, noEmbed)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(searchFreelancers("xx-XX", "logo", 6, noEmbed)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("compares only published pages in the client's market", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const a = await makeServicePage(await makeService(f.id), { locale: "de-DE" });
    const b = await makeServicePage(await makeService(f.id, { code: "B" }), { locale: "de-DE" });
    const us = await makeServicePage(await makeService(f.id, { code: "C" }), { locale: "en-US" });
    const draft = await makeServicePage(await makeService(f.id, { code: "D" }), { locale: "de-DE", status: "DRAFT" });
    await makeContract(f.id, c.id, [{ amount_minor: 1_000, state: "ACCEPTED" }, { amount_minor: 1_000, state: "DELIVERED" }]);
    const out = await compareServicePages("de-DE", [a.id, b.id]);
    expect(out.map((x) => x.service_page_id)).toEqual([a.id, b.id]);
    expect(out[0]!.freelancer.milestones_delivered_and_accepted).toBe(1);
    expect(out[0]!.packages.map((p) => p.tier)).toEqual(["BASIC", "STANDARD", "PREMIUM"]);
    await expect(compareServicePages("de-DE", [a.id, us.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(compareServicePages("de-DE", [a.id, draft.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("insights", () => {
  const usCtx: SaleContext = { currency: "USD", marketCountry: "US", freelancerCountry: "US", freelancerCurrency: "USD", platformBps: 500 };
  const net = (g: number) => estimateSaleFees(g, usCtx).net_to_freelancer;

  it("forecasts from money in holding and unfunded milestones due in the horizon", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const { milestones } = await makeContract(f.id, c.id, [
      { amount_minor: 10_000, state: "FUNDED" },
      { amount_minor: 5_000, state: "DISPUTED" },
      { amount_minor: 20_000 },
      { amount_minor: 30_000 },
    ]);
    const now = new Date();
    await prisma.milestone.update({ where: { id: milestones[2]!.milestone.id }, data: { due_date: new Date(now.getTime() + 10 * DAY) } });
    await prisma.milestone.update({ where: { id: milestones[3]!.milestone.id }, data: { due_date: new Date(now.getTime() + 100 * DAY) } });
    const { forecasts } = await forecastFreelancerEarnings(f.id, { horizonDays: 30 }, "en-US", now);
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0]).toMatchObject({
      currency: "USD",
      from_money_in_holding: { amount_minor: net(10_000) + net(5_000) },
      from_contracted_not_yet_funded: { amount_minor: net(20_000) },
      of_which_disputed: { amount_minor: net(5_000) },
      forecast_net_earnings: { amount_minor: net(10_000) + net(5_000) + net(20_000) },
      milestones_in_holding: 2,
      milestones_not_yet_funded: 1,
      low_confidence: true,
    });
    await expect(forecastFreelancerEarnings(f.id, { horizonDays: 0 }, "en-US")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("groups released earnings by client, net of refund debits", async () => {
    const f = await makeFreelancer();
    const nordlicht = await makeClient({ name: "Katrin Weber", company_name: "Nordlicht GmbH" });
    const ananya = await makeClient({ name: "Ananya Iyer" });
    const n = await makeContract(f.id, nordlicht.id, [{ amount_minor: 10_000, state: "ACCEPTED" }, { amount_minor: 5_000, state: "DELIVERED" }]);
    await makeContract(f.id, ananya.id, [{ amount_minor: 7_000, state: "ACCEPTED" }]);
    const paid = n.milestones[0]!;
    await prisma.milestoneRefund.create({
      data: { payment_id: paid.payment!.id, milestone_id: paid.milestone.id, contract_id: paid.milestone.contract_id, freelancer_id: f.id, currency: "USD", amount_minor: 1_000, reason: "Goodwill", from_holding: false, status: "COMPLETED", freelancer_debit_minor: 850 },
    });
    const period = resolvePeriod({ preset: "last_30_days" });
    const all = await earningsBy(f.id, "client", period, "en-US");
    const row = (name: string) => all.rows.find((r) => r.client === name)!;
    expect(row("Nordlicht GmbH")).toMatchObject({ milestones_released: 1, gross: { amount_minor: 10_000 }, net_released: { amount_minor: paid.payment!.net_to_freelancer_minor }, refund_debits: { amount_minor: 850 } });
    expect(row("Ananya Iyer")).toMatchObject({ milestones_released: 1, gross: { amount_minor: 7_000 } });
    const filtered = await earningsBy(f.id, "client", period, "en-US", "nordlicht");
    expect(filtered.rows.map((r) => r.client)).toEqual(["Nordlicht GmbH"]);
    const byMarket = await earningsBy(f.id, "market", period, "en-US");
    expect(byMarket.rows).toMatchObject([{ market: "en-US", milestones_released: 2 }]);
    await expect(earningsBy(f.id, "market", period, "en-US", "xx-XX")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("flags revision loops and open disputes", async () => {
    const f = await makeFreelancer();
    const c = await makeClient({ company_name: "Sakura Robotics K.K." });
    const { milestones } = await makeContract(f.id, c.id, [{ amount_minor: 10_000, state: "REVISION_REQUESTED" }, { amount_minor: 8_000, state: "DISPUTED" }], { revisions_allowed: 4 });
    await prisma.milestone.update({ where: { id: milestones[0]!.milestone.id }, data: { revision_count: 3 } });
    await prisma.milestone.update({ where: { id: milestones[1]!.milestone.id }, data: { dispute_reason: "Files missing" } });
    const { anomalies } = await detectFreelancerAnomalies(f.id, "en-US");
    expect(anomalies.find((a) => a.type === "revision_loop")).toMatchObject({ severity: "medium", evidence: { milestone_id: milestones[0]!.milestone.id, revisions: 3, revisions_allowed: 4, client: "Sakura Robotics K.K." } });
    expect(anomalies.find((a) => a.type === "open_dispute")).toMatchObject({ severity: "high", evidence: { milestone_id: milestones[1]!.milestone.id, reason: "Files missing" } });
    expect((await detectFreelancerAnomalies((await makeFreelancer()).id, "en-US")).anomaly_count).toBe(0);
  });
});
