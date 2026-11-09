import { type FxApi, frankfurter } from "../clients/frankfurter";
import { type EmbeddingApi, voyage } from "../clients/voyage";
import { prisma } from "../db";
import { amountAppearsIn, convertDecimalToMinor, normalizeUrl, type PriceStats, priceStats } from "../domain/market-prices";
import { getMarket, isMarketLocale, listMarkets, type Market } from "../domain/markets";
import { convertMinor, currencyExponent, money } from "../domain/money";
import { AppError, notFound } from "../errors";
import { liveModel, type ModelApi } from "../agents/model";
import { asJson, type AuditCtx } from "./audit";
import { latestResearch } from "./pricing";
import { searchWebPrices, type WebEvidence, type WebOffer } from "./web-prices";

/**
 * Market price research for one product in one market: what comparable
 * products sell for in that country's online shops (web search) and on
 * GlobalCart. The model only finds and reads offers; code validates each one
 * against what the search tool actually returned, converts it into the market
 * currency at today's ECB rate, drops outliers and computes the range. Results
 * are stored, reused for a day, and used by suggest_price for positioning.
 */

/** Reuse research this fresh instead of searching again (unless the seller asks to refresh). */
export const RESEARCH_REUSE_MS = 24 * 60 * 60 * 1000;
/** Markets researched at the same time: each search is ~10 s and ~25k tokens. */
const CONCURRENCY = 2;
/** Minimum cosine similarity for another GlobalCart listing to count as comparable. */
const SIMILARITY_FLOOR = 0.55;

type MoneyView = ReturnType<typeof money>;

export type MarketOffer = {
  source: "web" | "globalcart";
  shop: string;
  title: string;
  url: string | null;
  match: "same_product" | "comparable";
  /** Price as listed, in the shop's own currency, e.g. "€25.00" or "₹1,499 for 2". */
  listed_price: string;
  pack_quantity: number;
  /** Price per unit in the market currency (converted by code). */
  unit_price: MoneyView;
  /** True when the price was found on the page the search opened; false when only the report gave it. */
  price_on_page: boolean | null;
};

export type MarketResearchResult = {
  market: string;
  country: string;
  currency: string;
  researched_at: string;
  /** Statistics in minor units of `currency`, after outliers; null when nothing usable was found. */
  stats: PriceStats | null;
  /** Every kept unit price in minor units (for "cheaper than x% of offers"). */
  observed_minor: number[];
  range: { low: MoneyView; p25: MoneyView; median: MoneyView; p75: MoneyView; high: MoneyView } | null;
  offers: MarketOffer[];
  /** The seller's own listing of this product in this market, if any. */
  your_listing: { listing_id: string; status: string; price: MoneyView } | null;
  web: { status: "ok" | "no_offers" | "failed"; error: string | null; queries: string[]; dropped: Record<string, number> };
  globalcart: { status: "ok" | "unavailable"; note: string | null };
  fx: { from: string; to: string; rate: number; date: string }[];
  notes: string[];
};

function listedPrice(amount: string, currency: string, locale: string, pack: number): string {
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
  } catch {
    text = `${amount} ${currency}`;
  }
  return pack > 1 ? `${text} for ${pack}` : text;
}

/**
 * Keeps web offers that are usable: URL returned by the search tool, new
 * condition, sane pack size, a price and a currency that converts. Unit prices
 * are converted into the market currency by code.
 */
export async function validateWebOffers(
  offers: WebOffer[],
  evidence: WebEvidence[],
  market: Market,
  fx: FxApi,
): Promise<{ kept: MarketOffer[]; dropped: Record<string, number>; rates: MarketResearchResult["fx"] }> {
  const byUrl = new Map(evidence.map((e) => [normalizeUrl(e.url), e]));
  const dropped: Record<string, number> = {};
  const drop = (why: string) => (dropped[why] = (dropped[why] ?? 0) + 1);
  const rates = new Map<string, { from: string; to: string; rate: number; date: string }>();
  const seen = new Set<string>();
  const kept: MarketOffer[] = [];
  const exponent = currencyExponent(market.currency);

  for (const o of offers) {
    const key = normalizeUrl(o.url);
    if (!key || !byUrl.has(key)) {
      drop("url_not_in_search_results");
      continue;
    }
    if (seen.has(key)) {
      drop("duplicate");
      continue;
    }
    if (o.condition !== "new") {
      drop("used_item");
      continue;
    }
    if (!Number.isInteger(o.pack_quantity) || o.pack_quantity < 1 || o.pack_quantity > 50) {
      drop("bad_pack_size");
      continue;
    }
    const amount = o.price.trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      drop("bad_price");
      continue;
    }
    const currency = o.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      drop("unknown_currency");
      continue;
    }
    let rate = rates.get(currency);
    if (!rate) {
      try {
        const r = await fx.getRate(currency, market.currency);
        rate = { from: r.from, to: r.to, rate: r.rate, date: r.date };
        rates.set(currency, rate);
      } catch {
        drop("unknown_currency");
        continue;
      }
    }
    const unitMinor = Math.round(convertDecimalToMinor(amount, rate.rate, exponent) / o.pack_quantity);
    if (unitMinor <= 0) {
      drop("bad_price");
      continue;
    }
    seen.add(key);
    const page = byUrl.get(key)!;
    kept.push({
      source: "web",
      shop: o.shop.trim().slice(0, 120) || new URL(o.url).hostname,
      title: o.title.trim().slice(0, 200),
      url: o.url.trim(),
      match: o.match,
      listed_price: listedPrice(amount, currency, market.locale, o.pack_quantity),
      pack_quantity: o.pack_quantity,
      unit_price: money(unitMinor, market.currency, market.locale),
      price_on_page: amountAppearsIn(amount, `${page.title}\n${page.text}`),
    });
  }
  return { kept, dropped, rates: [...rates.values()].filter((r) => r.from !== r.to) };
}

type ProductRow = { id: string; title: string; description: string; attributes: unknown; category: string | null };

/** Other sellers' published listings in this market that are semantically close to the product. */
async function globalcartComparables(product: ProductRow, market: Market, embed: EmbeddingApi): Promise<{ offers: MarketOffer[]; note: string | null; ok: boolean }> {
  let vec: number[] | undefined;
  try {
    [vec] = await embed.embed([`${product.title}\n${product.description}`], "query");
  } catch {
    return { offers: [], note: "GlobalCart comparison needs product search (VOYAGE_API_KEY); skipped.", ok: false };
  }
  if (!vec) return { offers: [], note: null, ok: false };
  const literal = `[${vec.join(",")}]`;
  const rows = await prisma.$queryRaw<{ id: string; title: string; price_minor: number; currency: string; seller_name: string; similarity: number }[]>`
    SELECT l.id, l.title, l.price_minor, l.currency, s.name AS seller_name, 1 - (l.embedding <=> ${literal}::vector) AS similarity
    FROM listings l JOIN sellers s ON s.id = l.seller_id
    WHERE l.status = 'PUBLISHED' AND l.locale = ${market.locale} AND l.embedding IS NOT NULL AND l.product_id <> ${product.id}::uuid
    ORDER BY l.embedding <=> ${literal}::vector
    LIMIT 5`;
  const close = rows.filter((r) => Number(r.similarity) >= SIMILARITY_FLOOR && r.currency === market.currency);
  return {
    ok: true,
    note: close.length ? null : "No similar products from other sellers on GlobalCart in this market yet.",
    offers: close.map((r) => ({
      source: "globalcart" as const,
      shop: `GlobalCart · ${r.seller_name}`,
      title: r.title,
      url: null,
      match: "comparable" as const,
      listed_price: money(r.price_minor, r.currency, market.locale).display,
      pack_quantity: 1,
      unit_price: money(r.price_minor, r.currency, market.locale),
      price_on_page: null,
    })),
  };
}

type Deps = { model?: ModelApi; fx?: FxApi; embed?: EmbeddingApi };

async function researchOne(sellerId: string, product: ProductRow, locale: string, deps: Required<Deps>): Promise<MarketResearchResult> {
  const market = getMarket(locale);
  const audit: AuditCtx = { actor: { type: "SELLER", sellerId }, agent: "LISTING" };
  const notes: string[] = [];

  const own = await prisma.listing.findFirst({ where: { seller_id: sellerId, product_id: product.id, locale } });

  let web: MarketResearchResult["web"] = { status: "ok", error: null, queries: [], dropped: {} };
  let webOffers: MarketOffer[] = [];
  let rates: MarketResearchResult["fx"] = [];
  try {
    const found = await searchWebPrices(product, market, audit, deps.model);
    const v = await validateWebOffers(found.offers, found.evidence, market, deps.fx);
    webOffers = v.kept;
    rates = v.rates;
    web = { status: v.kept.length ? "ok" : "no_offers", error: null, queries: found.queries, dropped: v.dropped };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    web = { status: "failed", error: err.message, queries: [], dropped: {} };
  }

  const gc = await globalcartComparables(product, market, deps.embed);
  const offers = [...webOffers, ...gc.offers];
  const observed = offers.map((o) => o.unit_price.amount_minor);
  const stats = priceStats(observed);
  const m = (minor: number) => money(minor, market.currency, market.locale);

  if (stats && stats.count < 3) notes.push(`Only ${stats.count} comparable price${stats.count === 1 ? "" : "s"} found: treat the range as a rough guide.`);
  if (stats?.outliers) notes.push(`${stats.outliers} price${stats.outliers === 1 ? " was" : "s were"} far outside the rest and left out of the range.`);
  if (webOffers.some((o) => !o.price_on_page)) notes.push("Some prices could not be confirmed on the shop page; open the link to check.");
  if (market.country === "IN") notes.push("India is priced in USD on GlobalCart; local INR prices were converted at today's rate.");

  return {
    market: market.locale,
    country: market.country,
    currency: market.currency,
    researched_at: new Date().toISOString(),
    stats,
    observed_minor: observed,
    range: stats ? { low: m(stats.low), p25: m(stats.p25), median: m(stats.median), p75: m(stats.p75), high: m(stats.high) } : null,
    offers: offers.sort((a, b) => a.unit_price.amount_minor - b.unit_price.amount_minor),
    your_listing: own ? { listing_id: own.id, status: own.status, price: money(own.price_minor, own.currency, market.locale) } : null,
    web,
    globalcart: { status: gc.ok ? "ok" : "unavailable", note: gc.note },
    fx: rates,
    notes,
  };
}

async function ownedProduct(sellerId: string, productId: string): Promise<ProductRow> {
  const product = await prisma.product.findFirst({
    where: { id: productId, seller_id: sellerId },
    select: { id: true, title: true, description: true, attributes: true, category: true },
  });
  if (!product) throw notFound("Product");
  return product;
}

export type ResearchOutcome = { market: string; cached: boolean; research_id: string; result: MarketResearchResult } | { market: string; error: string };

/**
 * Researches several markets (two at a time). Fresh research from the last day
 * is reused unless `refresh` is set. A failure in one market does not stop the others.
 */
export async function researchMarketPrices(
  sellerId: string,
  productId: string,
  markets: string[],
  opts: Deps & { refresh?: boolean } = {},
): Promise<ResearchOutcome[]> {
  const locales = [...new Set(markets)];
  if (locales.length === 0) throw new AppError("INVALID_INPUT", "Choose at least one market.");
  for (const l of locales) if (!isMarketLocale(l)) throw new AppError("INVALID_INPUT", `Unknown market ${l}.`);
  const product = await ownedProduct(sellerId, productId);
  const deps: Required<Deps> = { model: opts.model ?? liveModel, fx: opts.fx ?? frankfurter, embed: opts.embed ?? voyage };

  const results: ResearchOutcome[] = new Array(locales.length);
  let next = 0;
  async function worker() {
    while (next < locales.length) {
      const i = next++;
      const locale = locales[i]!;
      try {
        if (!opts.refresh) {
          const hit = await latestResearch(sellerId, productId, locale, RESEARCH_REUSE_MS);
          // A failed web search is stored for the record but never reused.
          if (hit && hit.result.web.status !== "failed") {
            results[i] = { market: locale, cached: true, research_id: hit.id, result: hit.result };
            continue;
          }
        }
        const result = await researchOne(sellerId, product, locale, deps);
        const row = await prisma.marketPriceResearch.create({
          data: {
            seller_id: sellerId,
            product_id: productId,
            locale,
            currency: result.currency,
            result: asJson(result),
            offer_count: result.offers.length,
          },
        });
        results[i] = { market: locale, cached: false, research_id: row.id, result };
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results[i] = { market: locale, error: err.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, locales.length) }, worker));
  return results;
}

/** The newest research per market for a product (any age), for the editor. */
export async function savedMarketResearch(sellerId: string, productId: string) {
  await ownedProduct(sellerId, productId);
  const rows = await prisma.marketPriceResearch.findMany({
    where: { seller_id: sellerId, product_id: productId },
    orderBy: { created_at: "desc" },
    distinct: ["locale"],
  });
  return rows.map((r) => ({ market: r.locale, research_id: r.id, result: r.result as unknown as MarketResearchResult }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The seller's own picture of one product in every market: listing status and
 * price, that price in the seller's home currency, sales (90 days), traffic
 * (30 days) and the latest market range. Lets the agent spot markets that are
 * unlisted, overpriced or not converting.
 */
export async function productMarketOverview(sellerId: string, productId: string, fx: FxApi = frankfurter) {
  const product = await prisma.product.findFirst({ where: { id: productId, seller_id: sellerId }, include: { listings: true, seller: true } });
  if (!product) throw notFound("Product");
  const home = product.seller.currency;
  const listingIds = product.listings.map((l) => l.id);
  const [sold, traffic, research] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ["listing_id"],
      where: { listing_id: { in: listingIds }, order: { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] }, paid_at: { gte: new Date(Date.now() - 90 * DAY_MS) } } },
      _sum: { quantity: true },
    }),
    prisma.listingDailyStat.groupBy({
      by: ["listing_id"],
      where: { listing_id: { in: listingIds }, day: { gte: new Date(Date.now() - 30 * DAY_MS) } },
      _sum: { views: true, cart_adds: true },
    }),
    prisma.marketPriceResearch.findMany({ where: { seller_id: sellerId, product_id: productId }, orderBy: { created_at: "desc" }, distinct: ["locale"] }),
  ]);
  const soldBy = new Map(sold.map((s) => [s.listing_id, s._sum.quantity ?? 0]));
  const trafficBy = new Map(traffic.map((t) => [t.listing_id, t._sum]));
  const researchBy = new Map(research.map((r) => [r.locale, r]));
  const listingBy = new Map(product.listings.map((l) => [l.locale, l]));

  const markets = [];
  for (const market of listMarkets()) {
    const l = listingBy.get(market.locale);
    const r = researchBy.get(market.locale);
    const rr = r ? (r.result as unknown as MarketResearchResult) : null;
    let inHome: MoneyView | null = null;
    if (l) {
      try {
        const rate = await fx.getRate(l.currency, home);
        inHome = money(convertMinor(l.price_minor, l.currency, home, rate.rate), home);
      } catch {
        inHome = null;
      }
    }
    const t = l ? trafficBy.get(l.id) : undefined;
    const views = t?.views ?? 0;
    const units = l ? (soldBy.get(l.id) ?? 0) : 0;
    markets.push({
      market: market.locale,
      language: market.language,
      currency: market.currency,
      listing: l ? { listing_id: l.id, status: l.status, price: money(l.price_minor, l.currency, market.locale), price_in_home_currency: inHome } : null,
      units_sold_90d: units,
      views_30d: views,
      cart_adds_30d: t?.cart_adds ?? 0,
      market_range: rr?.range ? { low: rr.range.low, median: rr.range.median, high: rr.range.high, offers: rr.stats?.count ?? 0, researched_at: rr.researched_at } : null,
      price_vs_market:
        l && rr?.stats && rr.currency === l.currency
          ? l.price_minor > rr.stats.high
            ? "above_range"
            : l.price_minor < rr.stats.low
              ? "below_range"
              : l.price_minor > rr.stats.median
                ? "upper_half"
                : "lower_half"
          : null,
    });
  }
  return {
    product_id: product.id,
    title: product.title,
    home_currency: home,
    listed_in: markets.filter((m) => m.listing?.status === "PUBLISHED").length,
    markets,
    note: "Home-currency prices use today's ECB rate and are for comparison only. Sales are units in paid orders over the last 90 days; traffic is the last 30 days.",
  };
}
