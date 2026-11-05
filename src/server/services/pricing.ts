import { type FxApi, frankfurter } from "../clients/frankfurter";
import { coreConfig } from "../config";
import { prisma } from "../db";
import { ESTIMATE_NOTE, type SaleContext, type SaleFeeBreakdown } from "../domain/fees";
import { getMarket, isMarketLocale } from "../domain/markets";
import { convertMinor, money, parseDecimal } from "../domain/money";
import { type PriceWarning, suggestPrice } from "../domain/pricing";
import { AppError, notFound } from "../errors";

type QuoteRequest = {
  productId: string;
  locale: string;
  /** Decimal strings in the market currency, as the seller stated them. */
  competitorLow?: string;
  competitorHigh?: string;
  targetPrice?: string;
};

const WARNING_TEXT: Record<PriceWarning, string> = {
  LOSS_MAKING: "This price loses money after estimated fees and cost.",
  BELOW_TARGET_MARGIN: "This price is below the product's target margin.",
  ABOVE_COMPETITOR_RANGE: "The price is above the competitor range the seller gave.",
  BELOW_COMPETITOR_RANGE: "The price is below the competitor range the seller gave.",
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

  let result;
  try {
    result = suggestPrice({ landedCostMinor: landed, marginBps: product.margin_bps, rounding: market.rounding, sale, competitor, targetPriceMinor });
  } catch (err) {
    if (err instanceof RangeError) throw new AppError("INVALID_INPUT", err.message);
    throw err;
  }

  const m = (minor: number) => money(minor, market.currency, market.locale);
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
    warnings: result.warnings.map((code) => ({ code, message: WARNING_TEXT[code] })),
    fees_are_estimates: true,
    note: ESTIMATE_NOTE,
  };
}

export type PriceQuote = Awaited<ReturnType<typeof quotePrice>>;
