import { createHash } from "node:crypto";
import { type FxApi, frankfurter } from "../../clients/frankfurter";
import { type EmbeddingApi, voyage } from "../../clients/voyage";
import { prisma } from "../../db";
import { type PriceStats, priceStats } from "../../domain/market-prices";
import { getMarket, isMarketLocale, listMarkets, type Market } from "../../domain/markets";
import { convertMinor, money } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { liveModel, type ModelApi } from "../../agents/model";
import { asJson, type AuditCtx } from "../audit";
import { type MarketOffer, validateWebOffers } from "./web-offers";
import { searchWebRates, type ServiceFacts } from "./web-rates";

/**
 * Market rate research for one service in one market: what comparable
 * freelance services cost there (freelance platforms and agency rate pages,
 * via web search) and on GlobalGig (other freelancers' published pages). The
 * model only finds offers; code checks each URL came from the search,
 * converts every price into the market currency at today's ECB rate, drops
 * outliers and computes the range.
 *
 * What a price means: for a package service, one project comparable to its
 * Standard package (or its only package); for an hourly service, an hourly rate.
 */

export const RESEARCH_REUSE_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 2;
const SIMILARITY_FLOOR = 0.55;

type MoneyView = ReturnType<typeof money>;

export type RateResearchResult = {
  market: string;
  country: string;
  currency: string;
  unit: "project" | "hour";
  researched_at: string;
  stats: PriceStats | null;
  observed_minor: number[];
  range: { low: MoneyView; p25: MoneyView; median: MoneyView; p75: MoneyView; high: MoneyView } | null;
  offers: MarketOffer[];
  web: { status: "ok" | "no_offers" | "failed"; error: string | null; queries: string[]; dropped: Record<string, number> };
  globalgig: { status: "ok" | "unavailable"; note: string | null };
  fx: { from: string; to: string; rate: number; date: string }[];
  notes: string[];
};

export type ServiceSubject = { id: string | null; title: string; description: string; category: string; unit: "project" | "hour"; scope: string | null };

/** Same text, same research. */
export function serviceQueryHash(title: string, description: string): string {
  const norm = (t: string) => t.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`gig\n${norm(title)}\n${norm(description)}`).digest("hex");
}

async function globalgigComparables(freelancerId: string, s: ServiceSubject, market: Market, embed: EmbeddingApi) {
  let v: number[] | undefined;
  try {
    [v] = await embed.embed([`${s.title}\n${s.description}`], "query");
  } catch {
    return { offers: [] as MarketOffer[], note: "GlobalGig comparison needs search (VOYAGE_API_KEY); skipped.", ok: false };
  }
  if (!v) return { offers: [] as MarketOffer[], note: null, ok: false };
  const lit = `[${v.join(",")}]`;
  const rows = await prisma.$queryRaw<{ id: string; title: string; currency: string; hourly: number | null; standard: number | null; name: string; sim: number }[]>`
    SELECT p.id, p.title, p.currency, p.hourly_rate_minor AS hourly, f.name,
           (SELECT pp.price_minor FROM service_page_prices pp JOIN service_packages k ON k.id = pp.package_id
             WHERE pp.page_id = p.id ORDER BY (k.tier = 'STANDARD') DESC, pp.price_minor ASC LIMIT 1) AS standard,
           1 - (p.embedding <=> ${lit}::vector) AS sim
    FROM service_pages p JOIN freelancers f ON f.id = p.freelancer_id
    WHERE p.status = 'PUBLISHED' AND p.locale = ${market.locale} AND p.embedding IS NOT NULL AND p.freelancer_id <> ${freelancerId}::uuid
    ORDER BY p.embedding <=> ${lit}::vector LIMIT 6`;
  const offers: MarketOffer[] = rows
    .filter((r) => Number(r.sim) >= SIMILARITY_FLOOR && r.currency === market.currency)
    .map((r) => ({ r, price: s.unit === "hour" ? r.hourly : r.standard }))
    .filter((x): x is { r: (typeof rows)[number]; price: number } => x.price !== null)
    .map(({ r, price }) => ({
      source: "globalgig" as const, // provenance: a GlobalGig service page
      provider: `GlobalGig · ${r.name}`,
      title: r.title,
      url: null,
      match: "comparable" as const,
      listed_price: money(price, r.currency, market.locale).display,
      pack_quantity: 1,
      unit_price: money(price, r.currency, market.locale),
      price_on_page: null,
    }));
  return { offers, note: offers.length ? null : "No similar services from other freelancers on GlobalGig in this market yet.", ok: true };
}

type Deps = { model?: ModelApi; fx?: FxApi; embed?: EmbeddingApi };

async function researchOne(freelancerId: string, s: ServiceSubject, locale: string, deps: Required<Deps>): Promise<RateResearchResult> {
  const market = getMarket(locale);
  const audit: AuditCtx = { actor: { type: "FREELANCER", freelancerId }, agent: "PROFILE" };
  const notes: string[] = [];
  let web: RateResearchResult["web"] = { status: "ok", error: null, queries: [], dropped: {} };
  let webOffers: MarketOffer[] = [];
  let rates: RateResearchResult["fx"] = [];
  try {
    const facts: ServiceFacts = { title: s.title, description: s.description, category: s.category, unit: s.unit, scope: s.scope };
    const found = await searchWebRates(facts, market, audit, deps.model);
    const v = await validateWebOffers(found.offers, found.evidence, market, deps.fx);
    webOffers = v.kept;
    rates = v.rates;
    web = { status: v.kept.length ? "ok" : "no_offers", error: null, queries: found.queries, dropped: v.dropped };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    web = { status: "failed", error: err.message, queries: [], dropped: {} };
  }
  const gg = await globalgigComparables(freelancerId, s, market, deps.embed);
  const offers = [...webOffers, ...gg.offers];
  const observed = offers.map((o) => o.unit_price.amount_minor);
  const stats = priceStats(observed);
  const m = (minor: number) => money(minor, market.currency, market.locale);
  if (stats && stats.count < 3) notes.push(`Only ${stats.count} comparable price${stats.count === 1 ? "" : "s"} found: treat the range as a rough guide.`);
  if (stats?.outliers) notes.push(`${stats.outliers} price${stats.outliers === 1 ? " was" : "s were"} far outside the rest and left out of the range.`);
  if (webOffers.some((o) => !o.price_on_page)) notes.push("Some prices could not be confirmed on the page; open the link to check.");
  if (market.country === "IN") notes.push("India is priced in USD on GlobalGig; local INR prices were converted at today's rate.");
  notes.push(s.unit === "hour" ? "Prices are hourly rates." : "Prices are for one project comparable to the Standard package.");
  return {
    market: market.locale,
    country: market.country,
    currency: market.currency,
    unit: s.unit,
    researched_at: new Date().toISOString(),
    stats,
    observed_minor: observed,
    range: stats ? { low: m(stats.low), p25: m(stats.p25), median: m(stats.median), p75: m(stats.p75), high: m(stats.high) } : null,
    offers: offers.sort((a, b) => a.unit_price.amount_minor - b.unit_price.amount_minor),
    web,
    globalgig: { status: gg.ok ? "ok" : "unavailable", note: gg.note },
    fx: rates,
    notes,
  };
}

export type RateOutcome = { market: string; cached: boolean; research_id: string; result: RateResearchResult } | { market: string; error: string };

/** The subject of research for a saved service. */
export async function subjectOf(freelancerId: string, serviceId: string): Promise<ServiceSubject> {
  const s = await prisma.service.findFirst({ where: { id: serviceId, freelancer_id: freelancerId }, include: { packages: true } });
  if (!s) throw notFound("Service");
  const anchor = s.packages.find((p) => p.tier === "STANDARD") ?? s.packages[0];
  return { id: s.id, title: s.title, description: s.description, category: s.category, unit: s.pricing_model === "HOURLY" ? "hour" : "project", scope: anchor?.scope ?? null };
}

export async function researchServiceRates(freelancerId: string, subject: ServiceSubject, markets: string[], opts: Deps & { refresh?: boolean } = {}): Promise<RateOutcome[]> {
  const locales = [...new Set(markets)];
  if (locales.length === 0) throw new AppError("INVALID_INPUT", "Choose at least one market.");
  for (const l of locales) if (!isMarketLocale(l)) throw new AppError("INVALID_INPUT", `Unknown market ${l}.`);
  const deps: Required<Deps> = { model: opts.model ?? liveModel, fx: opts.fx ?? frankfurter, embed: opts.embed ?? voyage };
  const hash = serviceQueryHash(subject.title, subject.description);
  const results: RateOutcome[] = new Array(locales.length);
  let next = 0;
  async function worker() {
    while (next < locales.length) {
      const i = next++;
      const locale = locales[i]!;
      try {
        if (!opts.refresh) {
          const hit = await prisma.marketRateResearch.findFirst({
            where: { freelancer_id: freelancerId, locale, created_at: { gte: new Date(Date.now() - RESEARCH_REUSE_MS) }, OR: [...(subject.id ? [{ service_id: subject.id }] : []), { query_hash: hash }] },
            orderBy: { created_at: "desc" },
          });
          const r = hit?.result as unknown as RateResearchResult | undefined;
          if (hit && r && r.web.status !== "failed") {
            results[i] = { market: locale, cached: true, research_id: hit.id, result: r };
            continue;
          }
        }
        const result = await researchOne(freelancerId, subject, locale, deps);
        const row = await prisma.marketRateResearch.create({
          data: { freelancer_id: freelancerId, service_id: subject.id, query_hash: hash, locale, currency: result.currency, result: asJson(result), offer_count: result.offers.length },
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

/** Research done before a service existed now belongs to it. */
export async function linkDraftRateResearch(freelancerId: string, serviceId: string, title: string, description: string) {
  const { count } = await prisma.marketRateResearch.updateMany({
    where: { freelancer_id: freelancerId, service_id: null, query_hash: serviceQueryHash(title, description) },
    data: { service_id: serviceId },
  });
  return count;
}

/** Newest research for a service in a market, at most `maxAgeMs` old. */
export async function latestRateResearch(freelancerId: string, serviceId: string, locale: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const row = await prisma.marketRateResearch.findFirst({
    where: { freelancer_id: freelancerId, service_id: serviceId, locale, created_at: { gte: new Date(Date.now() - maxAgeMs) } },
    orderBy: { created_at: "desc" },
  });
  return row ? { id: row.id, created_at: row.created_at, result: row.result as unknown as RateResearchResult } : null;
}

/**
 * market_overview: one service in every market. Page status and price
 * (Standard package, or hourly rate), that price in the freelancer's home
 * currency, contracts started (90 days), views and quote requests (30 days),
 * the latest researched range and where the price sits in it.
 */
export async function serviceMarketOverview(freelancerId: string, serviceId: string, fx: FxApi = frankfurter) {
  const s = await prisma.service.findFirst({
    where: { id: serviceId, freelancer_id: freelancerId },
    include: { packages: true, pages: { include: { prices: true } }, freelancer: { select: { currency: true, locale: true } } },
  });
  if (!s) throw notFound("Service");
  const home = s.freelancer.currency;
  const anchorPkg = s.packages.find((p) => p.tier === "STANDARD") ?? s.packages[0];
  const pageIds = s.pages.map((p) => p.id);
  const since90 = new Date(Date.now() - 90 * 86_400_000);
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [contracts, traffic, research] = await Promise.all([
    prisma.contract.groupBy({ by: ["locale"], where: { service_id: s.id, created_at: { gte: since90 }, status: { in: ["ACTIVE", "COMPLETED"] } }, _count: true }),
    prisma.servicePageDailyStat.groupBy({ by: ["page_id"], where: { page_id: { in: pageIds }, day: { gte: since30 } }, _sum: { views: true, quote_requests: true } }),
    prisma.marketRateResearch.findMany({ where: { freelancer_id: freelancerId, service_id: s.id }, orderBy: { created_at: "desc" }, distinct: ["locale"] }),
  ]);
  const contractsBy = new Map(contracts.map((c) => [c.locale, c._count]));
  const trafficBy = new Map(traffic.map((t) => [t.page_id, t._sum]));
  const researchBy = new Map(research.map((r) => [r.locale, r.result as unknown as RateResearchResult]));
  const pageBy = new Map(s.pages.map((p) => [p.locale, p]));
  const markets = [];
  for (const mk of listMarkets()) {
    const p = pageBy.get(mk.locale);
    const r = researchBy.get(mk.locale);
    const priceMinor = p ? (s.pricing_model === "HOURLY" ? p.hourly_rate_minor : (p.prices.find((x) => x.package_id === anchorPkg?.id)?.price_minor ?? null)) : null;
    let inHome: MoneyView | null = null;
    if (p && priceMinor !== null) {
      try {
        const rate = await fx.getRate(p.currency, home);
        inHome = money(convertMinor(priceMinor, p.currency, home, rate.rate), home, s.freelancer.locale);
      } catch {
        inHome = null;
      }
    }
    const t = p ? trafficBy.get(p.id) : undefined;
    markets.push({
      market: mk.locale,
      language: mk.language,
      currency: mk.currency,
      page: p ? { page_id: p.id, status: p.status, price: priceMinor === null ? null : money(priceMinor, p.currency, mk.locale), price_in_home_currency: inHome } : null,
      priced_as: s.pricing_model === "HOURLY" ? "hourly rate" : "Standard package",
      contracts_started_90d: contractsBy.get(mk.locale) ?? 0,
      views_30d: t?.views ?? 0,
      quote_requests_30d: t?.quote_requests ?? 0,
      market_range: r?.range ? { low: r.range.low, median: r.range.median, high: r.range.high, comparables: r.stats?.count ?? 0, researched_at: r.researched_at } : null,
      price_vs_market:
        priceMinor !== null && r?.stats && r.currency === p?.currency
          ? priceMinor > r.stats.high
            ? "above_range"
            : priceMinor < r.stats.low
              ? "below_range"
              : priceMinor > r.stats.median
                ? "upper_half"
                : "lower_half"
          : null,
    });
  }
  return {
    service_id: s.id,
    title: s.title,
    home_currency: home,
    published_in: markets.filter((m) => m.page?.status === "PUBLISHED").length,
    markets,
    note: "Home-currency prices use today's ECB rate and are for comparison only. Contracts are the last 90 days; traffic is the last 30 days.",
  };
}
