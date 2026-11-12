import { type FxApi, frankfurter } from "../../clients/frankfurter";
import { coreConfig } from "../../config";
import { prisma } from "../../db";
import { ESTIMATE_NOTE, estimateSaleFees, type SaleContext } from "../../domain/fees";
import { getMarket, isMarketLocale } from "../../domain/markets";
import { convertMinor, money, parseDecimal } from "../../domain/money";
import { chooseRate, floorPrice } from "../../domain/rates";
import { AppError, notFound } from "../../errors";

/**
 * suggest_rate: what to charge for a project, in the client's currency. The
 * price never goes below the freelancer's floor (estimated hours x hourly
 * floor), net of estimated PayPal, international, conversion and platform
 * fees. With no price in mind it is the floor plus a modest margin. The
 * client's stated budget, if any, is compared with the result.
 */

type Warning = "TARGET_BELOW_FLOOR" | "FLOOR_ABOVE_BUDGET" | "ABOVE_BUDGET" | "NO_BUDGET";

const WARNING_TEXT: Record<Warning, string> = {
  TARGET_BELOW_FLOOR: "The price you asked about is below your hourly floor, so the floor price is suggested instead.",
  FLOOR_ABOVE_BUDGET: "Your hourly floor is above the client's stated budget. A proposal at your floor may be declined; consider explaining your value or skipping this project.",
  ABOVE_BUDGET: "The suggested price is above the client's stated budget.",
  NO_BUDGET: "The client did not state a budget, so there is nothing to compare the price with.",
};

export type RateRequest = {
  briefId: string;
  /** Estimated hours of work; the floor is hours x hourly floor. */
  hours: number;
  /** Decimal in the client's currency: a price to evaluate instead of the default margin. */
  targetPrice?: string;
};

export async function suggestRate(freelancerId: string, req: RateRequest, fx: FxApi = frankfurter) {
  if (!Number.isFinite(req.hours) || req.hours <= 0 || req.hours > 2_000) throw new AppError("INVALID_INPUT", "Estimated hours must be between 1 and 2000.");
  const brief = await prisma.brief.findFirst({ where: { id: req.briefId, OR: [{ status: "OPEN" }, { quotes: { some: { freelancer_id: freelancerId } } }] } });
  if (!brief) throw notFound("Project");
  if (!isMarketLocale(brief.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${brief.locale}.`);
  const f = await prisma.freelancer.findUniqueOrThrow({ where: { id: freelancerId } });
  const market = getMarket(brief.locale);
  const ctx: SaleContext = { currency: market.currency, marketCountry: market.country, freelancerCountry: f.country, freelancerCurrency: f.currency, platformBps: coreConfig().PLATFORM_FEE_BPS };
  const rate = await fx.getRate(f.currency, market.currency);
  const m = (minor: number) => money(minor, market.currency, market.locale);
  const target = req.targetPrice ? parseDecimal(req.targetPrice, market.currency) : null;
  if (target !== null && target <= 0) throw new AppError("INVALID_INPUT", "The price to evaluate must be more than zero.");

  const netFloor = Math.max(1, convertMinor(Math.round(req.hours * f.hourly_floor_minor), f.currency, market.currency, rate.rate));
  const floor = floorPrice(netFloor, ctx, market.rounding);
  const choice = chooseRate({ floor, target, rounding: market.rounding, currency: market.currency });
  const fees = estimateSaleFees(choice.price, ctx);

  const warnings = new Set<Warning>();
  if (choice.raisedToFloor) warnings.add("TARGET_BELOW_FLOOR");
  const budget = brief.budget_minor !== null && brief.budget_currency === market.currency ? brief.budget_minor : null;
  if (budget === null) warnings.add("NO_BUDGET");
  else if (floor > budget) warnings.add("FLOOR_ABOVE_BUDGET");
  else if (choice.price > budget) warnings.add("ABOVE_BUDGET");

  return {
    brief_id: brief.id,
    market: market.locale,
    currency: market.currency,
    estimated_hours: req.hours,
    suggested_price: m(choice.price),
    floor_price: m(floor),
    strategy: choice.strategy,
    estimated_fees: m(fees.total_fees),
    estimated_net_to_you: m(fees.net_to_freelancer),
    net_per_hour: m(Math.floor(fees.net_to_freelancer / req.hours)),
    your_hourly_floor: m(Math.max(1, convertMinor(f.hourly_floor_minor, f.currency, market.currency, rate.rate))),
    client_budget: budget === null ? null : m(budget),
    within_budget: budget === null ? null : choice.price <= budget,
    fx: { from: rate.from, to: rate.to, rate: rate.rate, date: rate.date },
    warnings: [...warnings].map((code) => ({ code, message: WARNING_TEXT[code] })),
    note: `${ESTIMATE_NOTE} The price never goes below your hourly floor after estimated fees.`,
  };
}

export type RateQuote = Awaited<ReturnType<typeof suggestRate>>;
