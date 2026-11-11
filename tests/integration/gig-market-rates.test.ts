import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatCompletion, liveModel } from "@/server/agents/model";
import { sendMessage } from "@/server/agents/orchestrator";
import { frankfurter } from "@/server/clients/frankfurter";
import { voyage } from "@/server/clients/voyage";
import { prisma } from "@/server/db";
import { getMarket } from "@/server/domain/markets";
import { validateWebOffers } from "@/server/services/gig/web-offers";
import { evidenceFrom, type WebOffer } from "@/server/services/gig/web-rates";
import { makeFreelancer, makeService, makeServicePage, resetDb } from "../helpers/db";
import { call, lastResponses, reply, scriptedModel, text } from "../helpers/fake-model";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const RATES: Record<string, number> = { "USD->EUR": 0.9, "INR->EUR": 0.011, "GBP->EUR": 1.2, "USD->JPY": 150, "EUR->USD": 1.1 };
function stubFx() {
  return vi.spyOn(frankfurter, "getRate").mockImplementation(async (from, to) => {
    const rate = from === to ? 1 : RATES[`${from}->${to}`];
    if (rate === undefined) throw new Error(`no rate ${from}->${to}`);
    return { from, to, rate, date: "2026-11-09", source: "ECB via Frankfurter" };
  });
}

/** A browser_search completion: the report text plus what the browser tool returned. */
function searchCompletion(report: string, pages: { url: string; text: string }[], hits: string[]): ChatCompletion {
  const c = reply([text(report)]);
  (c.choices[0]!.message as unknown as Record<string, unknown>).executed_tools = [
    {
      index: 0,
      type: "browser_search",
      arguments: JSON.stringify({ query: "stoneware mug Germany" }),
      output: "L0: URL: https://exa.ai/search?q=x # Search Results",
      search_results: { results: hits.map((url) => ({ url, title: "hit", content: "" })) },
    },
    ...pages.map((p, i) => ({ index: i + 1, type: "browser.open", arguments: "{}", output: `L0:\nL1: URL: ${p.url}\nL2: ${p.text}` })),
  ];
  return c;
}

const OFFERS = [
  // Price confirmed on the opened page.
  { provider: "Keramik", title: "Tasse mit Spots", url: "https://www.keramik.de/tasse", price: "25.00", currency: "EUR", pack_quantity: 1, match: "comparable", condition: "new" },
  // A 6-pack: unit price is 29.99 / 6.
  { provider: "Cookinglife", title: "Tassen 6er-Set", url: "https://cookinglife.de/tassen-6", price: "29.99", currency: "EUR", pack_quantity: 6, match: "comparable", condition: "new" },
  // USD price, converted at 0.9; only in search hits, so not confirmed on a page.
  { provider: "Modha", title: "Speckled mug", url: "https://modha.shop/products/mug?variant=1", price: "18.00", currency: "USD", pack_quantity: 1, match: "same_service", condition: "new" },
  // INR price.
  { provider: "Etsy", title: "Cozy cup", url: "https://www.etsy.com/listing/1", price: "2500", currency: "INR", pack_quantity: 1, match: "comparable", condition: "new" },
  // Invented URL: never returned by search, dropped.
  { provider: "Made up", title: "Ghost mug", url: "https://example.com/ghost", price: "9.99", currency: "EUR", pack_quantity: 1, match: "comparable", condition: "new" },
  // Used item: dropped.
  { provider: "eBay", title: "Old mug", url: "https://ebay.de/used", price: "5.00", currency: "EUR", pack_quantity: 1, match: "comparable", condition: "used" },
];

function researchSteps(offers = OFFERS) {
  return [
    searchCompletion(
      "Keramik | Tasse mit Spots | 25,00 € | ...",
      [{ url: "https://www.keramik.de/tasse", text: "Tasse mit Spots 25,00 € inkl. MwSt." }],
      ["https://www.keramik.de/tasse", "https://cookinglife.de/tassen-6", "https://modha.shop/products/mug", "https://www.etsy.com/listing/1", "https://ebay.de/used"],
    ),
    reply([text(JSON.stringify({ offers }))]),
  ];
}


describe("web offer validation", () => {
  it("keeps only offers the search returned, converts unit prices in code, and says why it dropped the rest", async () => {
    stubFx();
    const evidence = [
      { url: "https://www.keramik.de/tasse", title: "Tasse", text: "Tasse mit Spots 25,00 € inkl. MwSt." },
      { url: "https://cookinglife.de/tassen-6", title: "hit", text: "" },
      { url: "https://modha.shop/products/mug", title: "hit", text: "" },
      { url: "https://www.etsy.com/listing/1", title: "hit", text: "" },
      { url: "https://ebay.de/used", title: "hit", text: "" },
    ];
    const { kept, dropped, rates } = await validateWebOffers(OFFERS as unknown as WebOffer[], evidence, getMarket("de-DE"), frankfurter);
    expect(kept.map((o) => [o.provider, o.unit_price.amount_minor])).toEqual([
      ["Keramik", 2500],
      ["Cookinglife", 500], // 29.99 for six
      ["Modha", 1620], // 18.00 USD at 0.9
      ["Etsy", 2750], // 2500 INR at 0.011
    ]);
    expect(kept[0]!.price_on_page).toBe(true);
    expect(kept[2]!.price_on_page).toBe(false);
    expect(dropped).toEqual({ url_not_in_search_results: 1, used_item: 1 });
    expect(rates.map((r) => r.from).sort()).toEqual(["INR", "USD"]);
  });

  it("collects evidence only from what the browser tool returned", () => {
    const c = searchCompletion("x", [{ url: "https://shop.de/a", text: "19,99 €" }], ["https://shop.de/b"]);
    const { evidence, queries } = evidenceFrom(c);
    expect(evidence.map((e) => e.url).sort()).toEqual(["https://shop.de/a", "https://shop.de/b"]);
    expect(queries).toEqual(["stoneware mug Germany"]);
  });
});

describe("Profile Agent with market rate research", () => {
  async function gigWorld() {
    const f = await makeFreelancer({ hourly_floor_minor: 100 });
    const svc = await makeService(f.id);
    const page = await makeServicePage(svc, { locale: "de-DE", prices: { BASIC: 99_900, STANDARD: 99_900, PREMIUM: 99_900 } });
    return { f, svc, page };
  }
  const chatDeps = (m: ReturnType<typeof scriptedModel>["model"]) => ({ model: m, reasoningEffort: "medium" as const, modelId: "openai/gpt-oss-120b" });

  it("researches, prices at a positioning, and reprices an existing page", async () => {
    stubFx();
    const w = await gigWorld();
    const research = scriptedModel(researchSteps());
    vi.spyOn(liveModel, "chat").mockImplementation(research.model.chat);
    vi.spyOn(voyage, "embed").mockRejectedValue(new Error("no key"));
    const s = scriptedModel([
      reply([call("r", "research_market_rates", { service_id: w.svc.id, preview_id: null, markets: ["de-DE"], refresh: null })]),
      (params) => {
        const out = (lastResponses(params)[0]!.response as { output: { markets: { comparable_prices_found: number; unit: string }[] } }).output;
        // 5, not 4: a service has no "used" condition, so the eBay fixture is kept; the invented URL is still dropped.
        expect(out.markets[0]).toMatchObject({ comparable_prices_found: 5, unit: "project" });
        return reply([call("q", "suggest_rate", { service_id: w.svc.id, market: "de-DE", positioning: "market", target_price: null })]);
      },
      (params) => {
        const quote = (lastResponses(params)[0]!.response as { output: { quote_id: string; items: { tier: string; strategy: string }[] } }).output;
        expect(quote.items.find((i) => i.tier === "STANDARD")!.strategy).toBe("market");
        return reply([call("p", "reprice_service", { quote_id: quote.quote_id })]);
      },
      reply([text("Repriced Germany to match the market.")]),
    ]);
    const res = await sendMessage({ owner: { type: "FREELANCER", freelancerId: w.f.id }, agent: "PROFILE", serviceId: w.svc.id, text: "What do others charge in Germany? Match the market.", deps: chatDeps(s.model) });
    expect(res.turns[0]!.outcome).toBe("completed");
    const quoteRow = await prisma.agentAction.findFirstOrThrow({ where: { tool: "suggest_rate" } });
    const items = (quoteRow.output as { items: { package_id: string; suggested_price: { amount_minor: number } }[] }).items;
    const after = await prisma.servicePage.findUniqueOrThrow({ where: { id: w.page.id }, include: { prices: true } });
    expect(after.status).toBe("DRAFT");
    for (const p of after.prices) expect(p.price_minor).toBe(items.find((i) => i.package_id === p.package_id)!.suggested_price.amount_minor);
    expect(await prisma.marketRateResearch.count({ where: { service_id: w.svc.id, locale: "de-DE" } })).toBe(1);
  });

  it("researches a previewed service before creating it", async () => {
    stubFx();
    const f = await makeFreelancer();
    const research = scriptedModel(researchSteps());
    vi.spyOn(liveModel, "chat").mockImplementation(research.model.chat);
    vi.spyOn(voyage, "embed").mockRejectedValue(new Error("no key"));
    const spec = {
      title: "Hand-lettered mug designs",
      description: "Custom lettering for ceramic mugs, print-ready.",
      written_in: null,
      category: "Design",
      pricing_model: "PACKAGES",
      packages: [{ tier: "STANDARD", scope: "Three mug designs", delivery_days: 5, revisions: 2, estimated_hours: 6 }],
      code: null,
    };
    const s = scriptedModel([
      reply([call("p", "preview_service", spec)]),
      (params) => {
        const previewId = (lastResponses(params)[0]!.response as { output: { preview_id: string } }).output.preview_id;
        return reply([call("r", "research_market_rates", { service_id: null, preview_id: previewId, markets: ["de-DE"], refresh: null })]);
      },
      (params) => {
        const out = (lastResponses(params)[0]!.response as { output: { markets: { range: unknown }[] } }).output;
        expect(out.markets[0]!.range).not.toBeNull();
        return reply([text("Here is the summary and the market. Confirm?")]);
      },
    ]);
    const res = await sendMessage({ owner: { type: "FREELANCER", freelancerId: f.id }, agent: "PROFILE", text: "I do hand-lettered mug designs, about 6 hours for three.", deps: chatDeps(s.model) });
    expect(res.turns[0]!.outcome).toBe("completed");
    expect(await prisma.service.count()).toBe(0);
    expect(await prisma.marketRateResearch.count({ where: { service_id: null, freelancer_id: f.id } })).toBe(1);
  });

  it("rejects passing both or neither of service_id and preview_id", async () => {
    stubFx();
    const f = await makeFreelancer();
    const s = scriptedModel([
      reply([call("r", "research_market_rates", { service_id: null, preview_id: null, markets: ["de-DE"], refresh: null })]),
      (params) => {
        expect(lastResponses(params)[0]!.response).toMatchObject({ error: { code: "INVALID_INPUT" } });
        return reply([text("ok")]);
      },
    ]);
    await sendMessage({ owner: { type: "FREELANCER", freelancerId: f.id }, agent: "PROFILE", text: "rates?", deps: chatDeps(s.model) });
  });
});
