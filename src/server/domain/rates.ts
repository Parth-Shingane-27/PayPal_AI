import { estimateSaleFees, type SaleContext } from "./fees";
import { type Rounding, roundUpToPricePoint } from "./markets";

/**
 * Freelance rate maths, pure. The rule: no suggested price ever nets the
 * freelancer less than their hourly floor x the package's estimated hours,
 * after estimated PayPal, international, conversion and platform fees.
 */

/** Estimated net to the freelancer on a price, after the fee-table estimates. */
export function estimatedNet(grossMinor: number, ctx: SaleContext): number {
  return estimateSaleFees(grossMinor, ctx).net_to_freelancer;
}

/**
 * The lowest market price, rounded up to the market's price points, whose
 * estimated net is at least `netFloorMinor` (in the market currency).
 */
export function floorPrice(netFloorMinor: number, ctx: SaleContext, rounding: Rounding): number {
  if (!Number.isSafeInteger(netFloorMinor) || netFloorMinor <= 0) throw new Error(`Net floor must be a positive integer, got ${netFloorMinor}`);
  // Solve gross - fees(gross) >= floor from a close first guess, then step up until it holds.
  const fees = estimateSaleFees(10_000_000, ctx);
  const variableShare = (fees.total_fees - estimateSaleFees(0, ctx).total_fees) / 10_000_000;
  let gross = Math.ceil((netFloorMinor + estimateSaleFees(0, ctx).total_fees) / (1 - variableShare));
  gross = roundUpToPricePoint(Math.max(1, gross), rounding, ctx.currency);
  for (let i = 0; i < 50 && estimatedNet(gross, ctx) < netFloorMinor; i++) gross = roundUpToPricePoint(gross + 1, rounding, ctx.currency);
  return gross;
}

export type RateChoice = {
  price: number;
  /** Where the price came from. */
  strategy: "floor" | "floor_plus" | "target";
  /** The market or target price was below the floor and was raised to it. */
  raisedToFloor: boolean;
};

/** Without a target price, a modest margin over the floor. */
export const FLOOR_PLUS_BPS = 2_000;

/**
 * The suggested price for one item: the target, never below the floor; with
 * no target, the floor plus FLOOR_PLUS_BPS.
 */
export function chooseRate(input: { floor: number; target: number | null; rounding: Rounding; currency: string }): RateChoice {
  const round = (m: number) => roundUpToPricePoint(Math.max(1, m), input.rounding, input.currency);
  if (input.target !== null) {
    const t = round(input.target);
    return t >= input.floor ? { price: t, strategy: "target", raisedToFloor: false } : { price: input.floor, strategy: "floor", raisedToFloor: true };
  }
  return { price: round(Math.round(input.floor * (1 + FLOOR_PLUS_BPS / 10_000))), strategy: "floor_plus", raisedToFloor: false };
}
