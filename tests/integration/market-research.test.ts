import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatCompletion, liveModel } from "@/server/agents/model";
import { sendMessage } from "@/server/agents/orchestrator";
import { frankfurter } from "@/server/clients/frankfurter";
import { voyage } from "@/server/clients/voyage";
import { prisma } from "@/server/db";
import { localizeProduct } from "@/server/services/localize";
import { productMarketOverview, researchMarketPrices } from "@/server/services/market-research";
import { quotePrice } from "@/server/services/pricing";
import { evidenceFrom } from "@/server/services/web-prices";
import { makeListing, makeProduct, makeSeller, resetDb } from "../helpers/db";
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

/** Embedding client with no Voyage key: GlobalCart comparison is skipped. */
const noEmbed = { embed: async () => Promise.reject(new Error("VOYAGE_API_KEY missing")) };

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
  { shop: "Keramik", title: "Tasse mit Spots", url: "https://www.keramik.de/tasse", price: "25.00", currency: "EUR", pack_quantity: 1, match: "comparable", condition: "new" },
  // A 6-pack: unit price is 29.99 / 6.
  { shop: "Cookinglife", title: "Tassen 6er-Set", url: "https://cookinglife.de/tassen-6", price: "29.99", currency: "EUR", pack_quantity: 6, match: "comparable", condition: "new" },
  // USD price, converted at 0.9; only in search hits, so not confirmed on a page.
  { shop: "Modha", title: "Speckled mug", url: "https://modha.shop/products/mug?variant=1", price: "18.00", currency: "USD", pack_quantity: 1, match: "same_product", condition: "new" },
  // INR price.
  { shop: "Etsy", title: "Cozy cup", url: "https://www.etsy.com/listing/1", price: "2500", currency: "INR", pack_quantity: 1, match: "comparable", condition: "new" },
  // Invented URL: never returned by search, dropped.
  { shop: "Made up", title: "Ghost mug", url: "https://example.com/ghost", price: "9.99", currency: "EUR", pack_quantity: 1, match: "comparable", condition: "new" },
  // Used item: dropped.
  { shop: "eBay", title: "Old mug", url: "https://ebay.de/used", price: "5.00", currency: "EUR", pack_quantity: 1, match: "comparable", condition: "used" },
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

async function world() {
  const seller = await makeSeller({ country: "US", currency: "USD" });
  const product = await makeProduct(seller.id, { cost_minor: 800, shipping_minor: 400, cost_currency: "USD", margin_bps: 3000 });
  return { seller, product };
}

describe("market price research", () => {
  it("keeps only offers the search returned, converts unit prices, and computes the range", async () => {
    stubFx();
    const w = await world();
    const s = scriptedModel(researchSteps());
    const [out] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed });
    if (!out || "error" in out) throw new Error("research failed");
    const r = out.result;

    expect(r.currency).toBe("EUR");
    expect(r.web.status).toBe("ok");
    expect(r.web.dropped).toEqual({ url_not_in_search_results: 1, used_item: 1 });
    // Sorted by unit price: 6-pack 5.00, INR 27.50, USD 16.20, page 25.00
    expect(r.offers.map((o) => [o.shop, o.unit_price.amount_minor, o.price_on_page])).toEqual([
      ["Cookinglife", 500, false],
      ["Modha", 1620, false],
      ["Keramik", 2500, true],
      ["Etsy", 2750, false],
    ]);
    expect(r.offers.find((o) => o.shop === "Cookinglife")!.listed_price).toMatch(/for 6$/);
    expect(r.stats).toMatchObject({ count: 4, low: 500, high: 2750 });
    expect(r.globalcart.status).toBe("unavailable");
    expect(r.fx.map((f) => f.from).sort()).toEqual(["INR", "USD"]);

    // Two model calls: browser_search on the search model, then the strict extraction.
    expect(s.requests[0]!.tools).toEqual([{ type: "browser_search" }]);
    expect(JSON.stringify(s.requests[0]!.messages)).not.toContain(w.seller.id);
    expect(s.requests[1]!.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "market_offers", strict: true } });
    expect(await prisma.agentAction.count({ where: { tool: { in: ["model.market_search", "model.market_extract"] } } })).toBe(2);
    expect(await prisma.marketPriceResearch.count()).toBe(1);
  });

  it("reuses research from the last day unless asked to refresh", async () => {
    stubFx();
    const w = await world();
    const s = scriptedModel([...researchSteps(), ...researchSteps()]);
    await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed });
    const [again] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed });
    expect(again).toMatchObject({ cached: true });
    expect(s.requests).toHaveLength(2);
    const [fresh] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed, refresh: true });
    expect(fresh).toMatchObject({ cached: false });
    expect(s.requests).toHaveLength(4);
  });

  it("reports a failed search per market without failing the others", async () => {
    stubFx();
    const w = await world();
    const { default: Groq } = await import("groq-sdk");
    const s = scriptedModel([new Groq.RateLimitError(429, { error: { message: "rate" } }, "rate", new Headers())]);
    const [out] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed });
    if (!out || "error" in out) throw new Error("expected a stored result");
    expect(out.result.web).toMatchObject({ status: "failed", error: expect.stringMatching(/busy/) });
    expect(out.result.stats).toBeNull();
  });

  it("includes similar listings from other GlobalCart sellers", async () => {
    stubFx();
    const w = await world();
    const other = await makeSeller({ country: "DE", currency: "EUR", locale: "de-DE" });
    const otherProduct = await makeProduct(other.id);
    const theirs = await makeListing(other.id, otherProduct.id, { locale: "de-DE", price_minor: 3299, title: "Steinzeugbecher" });
    const own = await makeListing(w.seller.id, w.product.id, { locale: "de-DE", price_minor: 2999 });
    const vec = `[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    await prisma.$executeRawUnsafe(`UPDATE listings SET embedding = '${vec}'::vector WHERE id IN ('${theirs.id}', '${own.id}')`);
    const embed = { embed: async () => [Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))] };
    const s = scriptedModel(researchSteps([]));
    const [out] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed });
    if (!out || "error" in out) throw new Error("research failed");
    // Their listing counts; the seller's own listing of this product does not.
    expect(out.result.offers.map((o) => [o.source, o.unit_price.amount_minor])).toEqual([["globalcart", 3299]]);
    expect(out.result.your_listing).toMatchObject({ listing_id: own.id, price: { amount_minor: 2999 } });
  });

  it("retries once when gpt-oss output cannot be parsed", async () => {
    stubFx();
    const w = await world();
    const { default: Groq } = await import("groq-sdk");
    const parseFail = new Groq.BadRequestError(400, { error: { code: "output_parse_failed", message: "Parsing failed." } }, "Parsing failed.", new Headers());
    const s = scriptedModel([parseFail, ...researchSteps()]);
    const [out] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed });
    if (!out || "error" in out) throw new Error("research failed");
    expect(out.result.web.status).toBe("ok");
    expect(s.requests).toHaveLength(3);
  });

  it("explains a used-up daily allowance and searches again next time instead of reusing the failure", async () => {
    stubFx();
    const w = await world();
    const { default: Groq } = await import("groq-sdk");
    const tpd = new Groq.RateLimitError(429, { error: { message: "Rate limit reached on tokens per day (TPD)" } }, "Rate limit reached on tokens per day (TPD)", new Headers());
    const s = scriptedModel([tpd, ...researchSteps()]);
    const [first] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed });
    expect(first).toMatchObject({ result: { web: { status: "failed", error: expect.stringMatching(/allowance is used up/) } } });
    const [second] = await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: s.model, embed: noEmbed });
    expect(second).toMatchObject({ cached: false, result: { web: { status: "ok" } } });
  });

  it("refuses another seller's product", async () => {
    const w = await world();
    const stranger = await makeSeller();
    await expect(researchMarketPrices(stranger.id, w.product.id, ["de-DE"], { model: scriptedModel([]).model, embed: noEmbed })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("collects evidence only from what the browser tool returned", () => {
    const c = searchCompletion("x", [{ url: "https://shop.de/a", text: "19,99 €" }], ["https://shop.de/b"]);
    const { evidence, queries } = evidenceFrom(c);
    expect(evidence.map((e) => e.url).sort()).toEqual(["https://shop.de/a", "https://shop.de/b"]);
    expect(queries).toEqual(["stoneware mug Germany"]);
  });
});

describe("pricing with market research", () => {
  async function researched() {
    stubFx();
    const w = await world();
    await researchMarketPrices(w.seller.id, w.product.id, ["de-DE"], { model: scriptedModel(researchSteps()).model, embed: noEmbed });
    return w;
  }

  it("aims at the chosen positioning and reports where the price sits", async () => {
    const w = await researched();
    const premium = await quotePrice(w.seller.id, { productId: w.product.id, locale: "de-DE", positioning: "premium" });
    expect(premium.strategy).toBe("MARKET_ANCHOR");
    expect(premium.market).toMatchObject({ positioning: "premium", offers_compared: 4, range: { low: { amount_minor: 500 }, high: { amount_minor: 2750 } } });
    expect(premium.suggested_price.amount_minor).toBeGreaterThanOrEqual(premium.margin_floor_price.amount_minor);

    const plain = await quotePrice(w.seller.id, { productId: w.product.id, locale: "de-DE" });
    expect(plain.strategy).toBe("MARGIN_FLOOR");
    expect(plain.market).toMatchObject({ positioning: null });
    expect(premium.suggested_price.amount_minor).toBeGreaterThan(plain.suggested_price.amount_minor);
  });

  it("warns when costs make the market expensive, and never prices below the floor", async () => {
    stubFx();
    const seller = await makeSeller();
    const product = await makeProduct(seller.id, { cost_minor: 4000, shipping_minor: 1500, cost_currency: "USD" });
    await researchMarketPrices(seller.id, product.id, ["de-DE"], { model: scriptedModel(researchSteps()).model, embed: noEmbed });
    const q = await quotePrice(seller.id, { productId: product.id, locale: "de-DE", positioning: "competitive" });
    expect(q.strategy).toBe("MARGIN_FLOOR");
    expect(q.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["COSTS_ABOVE_MARKET", "ABOVE_MARKET_RANGE"]));
    expect(q.warnings.map((w) => w.code)).not.toContain("BELOW_TARGET_MARGIN");
  });

  it("says when there is no research to position against", async () => {
    stubFx();
    const w = await world();
    const q = await quotePrice(w.seller.id, { productId: w.product.id, locale: "de-DE", positioning: "market" });
    expect(q.market).toBeNull();
    expect(q.warnings.map((x) => x.code)).toContain("NO_MARKET_DATA");
  });

  it("one-click listings use the positioning", async () => {
    const w = await researched();
    const s = scriptedModel([reply([text(JSON.stringify({ listings: [{ market: "de-DE", title: "Becher", seo_title: "Becher", description: "Steinzeug." }] }))])]);
    const res = await localizeProduct(w.seller.id, w.product.id, ["de-DE"], s.model, { positioning: "premium" });
    const expected = await quotePrice(w.seller.id, { productId: w.product.id, locale: "de-DE", positioning: "premium" });
    expect(res.saved[0]).toMatchObject({ price: { amount_minor: expected.suggested_price.amount_minor }, market_position: expected.market!.position });
  });

  it("summarises the product across markets", async () => {
    const w = await researched();
    await makeListing(w.seller.id, w.product.id, { locale: "de-DE", price_minor: 9999 });
    const o = await productMarketOverview(w.seller.id, w.product.id);
    const de = o.markets.find((m) => m.market === "de-DE")!;
    expect(de).toMatchObject({ price_vs_market: "above_range", listing: { price_in_home_currency: { amount_minor: 10999, currency: "USD" } } });
    expect(o.markets.find((m) => m.market === "ja-JP")!.listing).toBeNull();
    expect(o.markets).toHaveLength(11);
  });
});

describe("Listing Agent with market research", () => {
  it("researches, prices at a positioning, and reprices an existing listing", async () => {
    stubFx();
    const w = await world();
    const listing = await makeListing(w.seller.id, w.product.id, { locale: "de-DE", price_minor: 9999 });
    // The research tool calls the live clients: script them separately from the agent.
    const research = scriptedModel(researchSteps());
    vi.spyOn(liveModel, "chat").mockImplementation(research.model.chat);
    vi.spyOn(voyage, "embed").mockRejectedValue(new Error("no key"));

    const s = scriptedModel([
      reply([call("r", "research_market_prices", { product_id: w.product.id, markets: ["de-DE"], refresh: null })]),
      (params) => {
        const [res] = lastResponses(params);
        const out = (res!.response as { output: { markets: { comparable_prices_found: number; your_listing: unknown }[] } }).output;
        expect(out.markets[0]).toMatchObject({ comparable_prices_found: 4, your_listing: { listing_id: listing.id } });
        return reply([call("q", "suggest_price", { product_id: w.product.id, market: "de-DE", competitor_low: null, competitor_high: null, target_price: null, positioning: "market" })]);
      },
      (params) => {
        const [res] = lastResponses(params);
        const quote = (res!.response as { output: { quote_id: string; strategy: string } }).output;
        expect(quote.strategy).toBe("MARKET_ANCHOR");
        return reply([call("p", "reprice_listing", { quote_id: quote.quote_id })]);
      },
      reply([text("Repriced Germany to match the market.")]),
    ]);
    const res = await sendMessage({
      owner: { type: "SELLER", sellerId: w.seller.id },
      agent: "LISTING",
      productId: w.product.id,
      text: "What does this sell for in Germany? Match the market.",
      deps: { model: s.model, reasoningEffort: "medium", modelId: "openai/gpt-oss-120b" },
    });
    expect(res.turns[0]!.outcome).toBe("completed");
    const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    const quote = await quotePrice(w.seller.id, { productId: w.product.id, locale: "de-DE", positioning: "market" });
    expect(after).toMatchObject({ status: "DRAFT", price_minor: quote.suggested_price.amount_minor, title: listing.title });
    expect(after.pricing).toMatchObject({ strategy: "MARKET_ANCHOR" });
  });
});
