import { type FxApi, frankfurter } from "../clients/frankfurter";
import { coreConfig } from "../config";
import { prisma } from "../db";
import { ESTIMATE_NOTE, type SaleContext, type SaleFeeBreakdown } from "../domain/fees";
import { anchorFor, type MarketPosition, type Positioning, positionOf } from "../domain/market-prices";
import { getMarket, isMarketLocale } from "../domain/markets";
import { convertMinor, money, parseDecimal } from "../domain/money";
import { type PriceWarning, suggestPrice } from "../domain/pricing";
import { AppError, notFound } from "../errors";
import type { MarketResearchResult } from "./market-research";

type QuoteRequest = {
  productId: string;
  locale: string;
  /** Decimal strings in the market currency, as the seller stated them. */
  competitorLow?: string;
  competitorHigh?: string;
  targetPrice?: string;
  /** Aim at the market's lower quartile, median or upper quartile, using the latest market research. */
  positioning?: Positioning;
};

/** Research older than this is not used for pricing; the seller is asked to check prices again. */
export const RESEARCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Newest market research for (product, market), if any. Ownership is checked by seller_id. */
export async function latestResearch(sellerId: string, productId: string, locale: string, maxAgeMs = RESEARCH_MAX_AGE_MS) {
  const row = await prisma.marketPriceResearch.findFirst({
    where: { seller_id: sellerId, product_id: productId, locale, created_at: { gte: new Date(Date.now() - maxAgeMs) } },
    orderBy: { created_at: "desc" },
  });
  return row ? { id: row.id, created_at: row.created_at, result: row.result as unknown as MarketResearchResult } : null;
}

type MarketWarning = "ABOVE_MARKET_RANGE" | "BELOW_MARKET_RANGE" | "COSTS_ABOVE_MARKET" | "NO_MARKET_DATA";

const WARNING_TEXT: Record<PriceWarning | MarketWarning, string> = {
  LOSS_MAKING: "This price loses money after estimated fees and cost.",
  BELOW_TARGET_MARGIN: "This price is below the product's target margin.",
  ABOVE_COMPETITOR_RANGE: "The price is above the competitor range the seller gave.",
  BELOW_COMPETITOR_RANGE: "The price is below the competitor range the seller gave.",
  ABOVE_MARKET_RANGE: "The price is above every comparable price found in this market.",
  BELOW_MARKET_RANGE: "The price is below every comparable price found in this market; you may be leaving money on the table.",
  COSTS_ABOVE_MARKET: "Cost, shipping and fees put the lowest price that meets the target margin above the typical market price here.",
  NO_MARKET_DATA: "No recent market price research for this market, so the price is based on cost and margin only. Check market prices first.",
};

export function feeView(fees: SaleFeeBreakdown, currency: string, locale: string) {
  return {
    paypal_fee: money(fees.paypal_fee, currency, locale),
    international_fee: money(fees.international_fee, currency, locale),
    conversion_cost: money(fees.conversion_cost, currency, locale),
    platform_fee: money(fees.platform_fee, currency, locale),
    total_fees: money(fees.total_fees, currency, locale),
    net_to_seller: money(fees.net_to_seller, currency, locale),
  };
}

export async function saleContextFor(sellerId: string, locale: string): Promise<SaleContext> {
  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) throw notFound("Seller");
  const market = getMarket(locale);
  return {
    currency: market.currency,
    marketCountry: market.country,
    sellerCountry: seller.country,
    sellerCurrency: seller.currency,
    platformBps: coreConfig().PLATFORM_FEE_BPS,
  };
}

/**
 * A price quote for one product in one market. Every number is computed here;
 * the Listing Agent saves drafts by referring to this quote, never by retyping
 * its numbers.
 */
export async function quotePrice(sellerId: string, req: QuoteRequest, fx: FxApi = frankfurter) {
  if (!isMarketLocale(req.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${req.locale}.`);
  const product = await prisma.product.findFirst({ where: { id: req.productId, seller_id: sellerId } });
  if (!product) throw notFound("Product");

  const market = getMarket(req.locale);
  const sale = await saleContextFor(sellerId, req.locale);
  const rate = await fx.getRate(product.cost_currency, market.currency);
  const landed = convertMinor(product.cost_minor + product.shipping_minor, product.cost_currency, market.currency, rate.rate);

  const hasLow = req.competitorLow !== undefined;
  const hasHigh = req.competitorHigh !== undefined;
  if (hasLow !== hasHigh) throw new AppError("INVALID_INPUT", "Give both ends of the competitor range, or neither.");
  const competitor =
    req.competitorLow !== undefined && req.competitorHigh !== undefined
      ? { lowMinor: parseDecimal(req.competitorLow, market.currency), highMinor: parseDecimal(req.competitorHigh, market.currency) }
      : undefined;
  if (competitor && (competitor.lowMinor <= 0 || competitor.lowMinor > competitor.highMinor)) {
    throw new AppError("INVALID_INPUT", "The competitor range must be positive with low <= high.");
  }
  const targetPriceMinor = req.targetPrice === undefined ? undefined : parseDecimal(req.targetPrice, market.currency);
  if (targetPriceMinor !== undefined && targetPriceMinor <= 0) throw new AppError("INVALID_INPUT", "Target price must be positive.");

  // Market research: an anchor when the seller chose a positioning (and gave no
  // explicit range or price), and context for every quote.
  const research = await latestResearch(sellerId, product.id, market.locale);
  const stats = research && research.result.currency === market.currency ? research.result.stats : null;
  const marketAnchorMinor = req.positioning && stats && !competitor && targetPriceMinor === undefined ? anchorFor(stats, req.positioning) : undefined;

  let result;
  try {
    result = suggestPrice({ landedCostMinor: landed, marginBps: product.margin_bps, rounding: market.rounding, sale, competitor, targetPriceMinor, marketAnchorMinor });
  } catch (err) {
    if (err instanceof RangeError) throw new AppError("INVALID_INPUT", err.message);
    throw err;
  }

  const m = (minor: number) => money(minor, market.currency, market.locale);
  const warnings: (PriceWarning | MarketWarning)[] = [...result.warnings];
  let marketContext: {
    research_id: string;
    researched_at: string;
    offers_compared: number;
    range: { low: ReturnType<typeof m>; median: ReturnType<typeof m>; high: ReturnType<typeof m> };
    positioning: Positioning | null;
    position: MarketPosition;
    cheaper_offers_percent: number;
  } | null = null;
  if (stats && research) {
    const pos = positionOf(result.price_minor, stats, research.result.observed_minor);
    if (pos.position === "ABOVE_MARKET") warnings.push("ABOVE_MARKET_RANGE");
    if (pos.position === "BELOW_MARKET") warnings.push("BELOW_MARKET_RANGE");
    if (result.floor_price_minor > stats.median) warnings.push("COSTS_ABOVE_MARKET");
    marketContext = {
      research_id: research.id,
      researched_at: research.created_at.toISOString(),
      offers_compared: stats.count,
      range: { low: m(stats.low), median: m(stats.median), high: m(stats.high) },
      positioning: marketAnchorMinor !== undefined ? req.positioning! : null,
      position: pos.position,
      cheaper_offers_percent: pos.cheaper_offers_percent,
    };
  } else if (req.positioning) {
    warnings.push("NO_MARKET_DATA");
  }

  return {
    product_id: product.id,
    locale: market.locale,
    currency: market.currency,
    fx_rate: { from: rate.from, to: rate.to, rate: rate.rate, date: rate.date, source: rate.source },
    landed_cost: m(landed),
    landed_cost_source: money(product.cost_minor + product.shipping_minor, product.cost_currency),
    suggested_price: m(result.price_minor),
    margin_floor_price: m(result.floor_price_minor),
    strategy: result.strategy,
    competitor_range: competitor ? { low: m(competitor.lowMinor), high: m(competitor.highMinor) } : null,
    fees: feeView(result.fees, market.currency, market.locale),
    profit: m(result.profit_minor),
    margin_percent: result.margin_bps / 100,
    target_margin_percent: product.margin_bps / 100,
    market: marketContext,
    warnings: warnings.map((code) => ({ code, message: WARNING_TEXT[code] })),
    fees_are_estimates: true,
    note: ESTIMATE_NOTE,
  };
}

export type PriceQuote = Awaited<ReturnType<typeof quotePrice>>;
