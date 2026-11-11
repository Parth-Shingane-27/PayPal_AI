import { type FxApi, frankfurter } from "../../clients/frankfurter";
import { coreConfig } from "../../config";
import { prisma } from "../../db";
import { ESTIMATE_NOTE, estimateSaleFees, type SaleContext } from "../../domain/fees";
import { type Positioning, positionOf } from "../../domain/market-prices";
import { getMarket, isMarketLocale } from "../../domain/markets";
import { convertMinor, money, parseDecimal } from "../../domain/money";
import { chooseRate, floorPrice, scaledAnchor } from "../../domain/rates";
import { AppError, notFound } from "../../errors";
import { latestRateResearch } from "./market-rates";

/**
 * suggest_rate: a market price for each package of a service (or its hourly
 * rate), aimed at the researched market (competitive = lower quartile,
 * market = median, premium = upper quartile), and never below the
 * freelancer's floor: estimated hours x hourly floor, net of estimated fees.
 * Research prices one Standard-sized project; other packages scale by hours.
 */

type Warning = "NO_MARKET_DATA" | "FEW_COMPARABLES" | "FLOOR_ABOVE_MARKET" | "TARGET_BELOW_FLOOR" | "ABOVE_MARKET_RANGE" | "BELOW_MARKET_RANGE";

const WARNING_TEXT: Record<Warning, string> = {
  NO_MARKET_DATA: "No recent rate research for this market, so prices are your floor plus 20%. Research the market first for a market-based price.",
  FEW_COMPARABLES: "Fewer than 3 comparable prices were found; treat the market position as a rough guide.",
  FLOOR_ABOVE_MARKET: "Your hourly floor puts at least one package above the typical market price here; it was priced at your floor.",
  TARGET_BELOW_FLOOR: "The price you asked about is below your hourly floor, so the floor price is suggested instead.",
  ABOVE_MARKET_RANGE: "At least one price is above every comparable price found in this market.",
  BELOW_MARKET_RANGE: "At least one price is below every comparable price found here; you may be leaving money on the table.",
};

export type RateRequest = {
  serviceId: string;
  locale: string;
  positioning?: Positioning;
  /** Decimal in the market currency: the Standard package (or hourly) price to evaluate. */
  targetPrice?: string;
};

export async function suggestRate(freelancerId: string, req: RateRequest, fx: FxApi = frankfurter) {
  if (!isMarketLocale(req.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${req.locale}.`);
  const s = await prisma.service.findFirst({ where: { id: req.serviceId, freelancer_id: freelancerId }, include: { packages: true, freelancer: true } });
  if (!s) throw notFound("Service");
  const market = getMarket(req.locale);
  const f = s.freelancer;
  const ctx: SaleContext = { currency: market.currency, marketCountry: market.country, freelancerCountry: f.country, freelancerCurrency: f.currency, platformBps: coreConfig().PLATFORM_FEE_BPS };
  const rate = await fx.getRate(f.currency, market.currency);
  const m = (minor: number) => money(minor, market.currency, market.locale);
  const home = (minor: number) => money(minor, f.currency, f.locale);

  const research = req.positioning ? await latestRateResearch(freelancerId, s.id, market.locale) : null;
  const stats = research && research.result.currency === market.currency ? research.result.stats : null;
  const warnings = new Set<Warning>();
  if (req.positioning && !stats) warnings.add("NO_MARKET_DATA");
  if (stats && stats.count < 3) warnings.add("FEW_COMPARABLES");

  const hourly = s.pricing_model === "HOURLY";
  const items = hourly ? [{ tier: null, package_id: null, hours: 1 }] : [...s.packages].sort((a, b) => a.estimated_hours - b.estimated_hours).map((p) => ({ tier: p.tier, package_id: p.id, hours: p.estimated_hours }));
  if (items.length === 0) throw new AppError("CONFLICT", "This service has no packages to price.");
  const anchorHours = hourly ? 1 : (s.packages.find((p) => p.tier === "STANDARD") ?? s.packages[0]!).estimated_hours;
  const target = req.targetPrice ? parseDecimal(req.targetPrice, market.currency) : null;
  if (target !== null && target <= 0) throw new AppError("INVALID_INPUT", "The price to evaluate must be more than zero.");

  const priced = items.map((it) => {
    const netFloorHome = it.hours * f.hourly_floor_minor;
    const netFloor = Math.max(1, convertMinor(netFloorHome, f.currency, market.currency, rate.rate));
    const floor = floorPrice(netFloor, ctx, market.rounding);
    const anchor = stats && req.positioning ? scaledAnchor(stats, req.positioning, it.hours, anchorHours) : null;
    const scaledTarget = target === null ? null : Math.round((target * it.hours) / anchorHours);
    const choice = chooseRate({ floor, anchor, target: scaledTarget, rounding: market.rounding, currency: market.currency });
    if (choice.raisedToFloor) warnings.add(target !== null ? "TARGET_BELOW_FLOOR" : "FLOOR_ABOVE_MARKET");
    const fees = estimateSaleFees(choice.price, ctx);
    const pos = stats ? positionOf(Math.round((choice.price * anchorHours) / it.hours), stats, research!.result.observed_minor) : null;
    if (pos?.position === "ABOVE_MARKET") warnings.add("ABOVE_MARKET_RANGE");
    if (pos?.position === "BELOW_MARKET") warnings.add("BELOW_MARKET_RANGE");
    return {
      tier: it.tier,
      package_id: it.package_id,
      estimated_hours: hourly ? null : it.hours,
      suggested_price: m(choice.price),
      floor_price: m(floor),
      strategy: choice.strategy,
      estimated_fees: m(fees.total_fees),
      estimated_net_to_you: m(fees.net_to_freelancer),
      net_per_hour: m(Math.floor(fees.net_to_freelancer / it.hours)),
      your_hourly_floor: m(Math.max(1, convertMinor(f.hourly_floor_minor, f.currency, market.currency, rate.rate))),
      market_position: pos ? { position: pos.position.toLowerCase(), cheaper_offers_percent: pos.cheaper_offers_percent } : null,
    };
  });

  return {
    service_id: s.id,
    market: market.locale,
    currency: market.currency,
    unit: hourly ? ("hour" as const) : ("package" as const),
    positioning: req.positioning ?? null,
    items: priced,
    hourly_floor: home(f.hourly_floor_minor),
    fx: { from: rate.from, to: rate.to, rate: rate.rate, date: rate.date },
    market_range: stats
      ? { unit: hourly ? "hour" : "Standard-sized project", low: m(stats.low), median: m(stats.median), high: m(stats.high), comparables: stats.count, researched_at: research!.result.researched_at }
      : null,
    warnings: [...warnings].map((code) => ({ code, message: WARNING_TEXT[code] })),
    note: `${ESTIMATE_NOTE} Prices never go below your hourly floor after estimated fees.`,
  };
}

export type RateQuote = Awaited<ReturnType<typeof suggestRate>>;
