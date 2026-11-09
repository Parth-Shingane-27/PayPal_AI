import { estimateSaleFees, type SaleContext, type SaleFeeBreakdown, variableFeeBps } from "./fees";
import type { Rounding } from "./markets";
import { currencyExponent } from "./money";

/**
 * Natural price points, always rounding UP so the margin is never reduced:
 *  - x99:   12.34 -> 12.99, 12.99 -> 12.99
 *  - ends9: whole units ending in 9 (MXN): 123.45 -> 129.00
 *  - tens:  multiples of 10 (JPY): 1234 -> 1240
 */
export function roundUpToPricePoint(minor: number, rounding: Rounding, currency: string): number {
  const unit = 10 ** currencyExponent(currency);
  switch (rounding) {
    case "x99":
      return Math.ceil((minor + 1) / unit) * unit - 1;
    case "ends9": {
      const whole = Math.ceil(minor / unit);
      return (Math.ceil((whole + 1) / 10) * 10 - 1) * unit;
    }
    case "tens": {
      const step = 10 * unit;
      return Math.ceil(minor / step) * step;
    }
  }
}

type PriceInputs = {
  /** Product cost plus shipping, already converted into the market currency. */
  landedCostMinor: number;
  marginBps: number;
  rounding: Rounding;
  sale: SaleContext;
  competitor?: { lowMinor: number; highMinor: number };
  /** Price the seller asked to evaluate; used as-is, without rounding. */
  targetPriceMinor?: number;
  /** Observed market price to aim for (from market research); never priced below the margin floor. */
  marketAnchorMinor?: number;
};

export type PriceWarning =
  | "BELOW_TARGET_MARGIN"
  | "ABOVE_COMPETITOR_RANGE"
  | "BELOW_COMPETITOR_RANGE"
  | "LOSS_MAKING";

type PriceResult = {
  price_minor: number;
  /** Lowest price that meets the target margin, before rounding. */
  floor_price_minor: number;
  strategy: "MARGIN_FLOOR" | "COMPETITOR_LOW" | "SELLER_TARGET" | "MARKET_ANCHOR";
  fees: SaleFeeBreakdown;
  profit_minor: number;
  /** Profit / price, in basis points. */
  margin_bps: number;
  warnings: PriceWarning[];
};

function profitAt(price: number, inputs: PriceInputs): number {
  return estimateSaleFees(price, inputs.sale).net_to_seller - inputs.landedCostMinor;
}

function meetsMargin(price: number, inputs: PriceInputs): boolean {
  // profit / price >= margin, in integers: profit * 10000 >= margin * price
  return profitAt(price, inputs) * 10_000 >= inputs.marginBps * price;
}

/** Lowest price (minor units) whose estimated profit meets the target margin. */
export function marginFloor(inputs: PriceInputs): number {
  const keepBps = 10_000 - variableFeeBps(inputs.sale) - inputs.marginBps;
  if (keepBps <= 0) {
    throw new RangeError("Target margin plus fees exceed 100% of the price; no price can meet it.");
  }
  const fixed = estimateSaleFees(0, inputs.sale).paypal_fee; // fixed part only at price 0
  let price = Math.max(1, Math.ceil(((inputs.landedCostMinor + fixed) * 10_000) / keepBps));
  // Per-component rounding can put the closed form a unit or two off in
  // either direction; settle on the lowest price that meets the margin.
  while (!meetsMargin(price, inputs)) price += 1;
  while (price > 1 && meetsMargin(price - 1, inputs)) price -= 1;
  return price;
}

export function suggestPrice(inputs: PriceInputs): PriceResult {
  const floor = marginFloor(inputs);
  const { competitor, targetPriceMinor, marketAnchorMinor, rounding, sale } = inputs;

  let price: number;
  let strategy: PriceResult["strategy"];
  if (targetPriceMinor !== undefined) {
    price = targetPriceMinor;
    strategy = "SELLER_TARGET";
  } else if (competitor && floor < competitor.lowMinor) {
    price = roundUpToPricePoint(competitor.lowMinor, rounding, sale.currency);
    strategy = "COMPETITOR_LOW";
  } else if (!competitor && marketAnchorMinor !== undefined && floor < marketAnchorMinor) {
    price = roundUpToPricePoint(marketAnchorMinor, rounding, sale.currency);
    strategy = "MARKET_ANCHOR";
  } else {
    price = roundUpToPricePoint(floor, rounding, sale.currency);
    strategy = "MARGIN_FLOOR";
  }

  const fees = estimateSaleFees(price, sale);
  const profit = fees.net_to_seller - inputs.landedCostMinor;
  const warnings: PriceWarning[] = [];
  if (profit < 0) warnings.push("LOSS_MAKING");
  if (!meetsMargin(price, inputs)) warnings.push("BELOW_TARGET_MARGIN");
  if (competitor && price > competitor.highMinor) warnings.push("ABOVE_COMPETITOR_RANGE");
  if (competitor && price < competitor.lowMinor) warnings.push("BELOW_COMPETITOR_RANGE");

  return {
    price_minor: price,
    floor_price_minor: floor,
    strategy,
    fees,
    profit_minor: profit,
    margin_bps: price > 0 ? Math.floor((profit * 10_000) / price) : 0,
    warnings,
  };
}
