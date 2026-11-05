import { applyBps, type Currency, currencyExponent } from "./money";

/**
 * Fee ESTIMATES used for pricing, planning and comparisons. These are not
 * PayPal's actual fees: a recorded payment always uses the fee PayPal reports
 * at capture. Every tool that returns these numbers labels them as estimates.
 */
export const FEE_TABLE = {
  /** PayPal commercial transaction rate. */
  paypal_rate_bps: 349,
  /** Extra when the buyer's country differs from the seller's. */
  international_bps: 150,
  /** Spread when the seller later converts a foreign-currency balance home. */
  conversion_bps: 300,
  /** Payouts: 2% of the payout, capped per currency. */
  payout_bps: 200,
  fixed_fee_minor: { USD: 49, GBP: 39, EUR: 39, CAD: 59, AUD: 59, MXN: 400, JPY: 40 } satisfies Record<Currency, number>,
  payout_fee_cap_minor: { USD: 2000, GBP: 1600, EUR: 1800, CAD: 2700, AUD: 3000, MXN: 40000, JPY: 3000 } satisfies Record<
    Currency,
    number
  >,
} as const;

export const ESTIMATE_NOTE =
  "Fees are estimates from GlobalCart's fee table (PayPal 3.49% + fixed fee, +1.5% international, 3% conversion spread, payout fee 2% capped). Actual PayPal fees are recorded at capture.";

export type SaleContext = {
  currency: string;
  /** Country of the buying market. */
  marketCountry: string;
  sellerCountry: string;
  sellerCurrency: string;
  platformBps: number;
};

export type SaleFeeBreakdown = {
  paypal_fee: number;
  international_fee: number;
  conversion_cost: number;
  platform_fee: number;
  total_fees: number;
  net_to_seller: number;
};

function fixedFee(currency: string): number {
  currencyExponent(currency); // validates the currency
  return FEE_TABLE.fixed_fee_minor[currency as Currency];
}

function isInternational(ctx: Pick<SaleContext, "marketCountry" | "sellerCountry">): boolean {
  return ctx.marketCountry !== ctx.sellerCountry;
}

function needsConversion(ctx: Pick<SaleContext, "currency" | "sellerCurrency">): boolean {
  return ctx.currency !== ctx.sellerCurrency;
}

/** Estimated fees for one sale of `grossMinor` (in ctx.currency). */
export function estimateSaleFees(grossMinor: number, ctx: SaleContext): SaleFeeBreakdown {
  const paypal_fee = applyBps(grossMinor, FEE_TABLE.paypal_rate_bps) + fixedFee(ctx.currency);
  const international_fee = isInternational(ctx) ? applyBps(grossMinor, FEE_TABLE.international_bps) : 0;
  const conversion_cost = needsConversion(ctx) ? applyBps(grossMinor, FEE_TABLE.conversion_bps) : 0;
  const platform_fee = applyBps(grossMinor, ctx.platformBps);
  const total_fees = paypal_fee + international_fee + conversion_cost + platform_fee;
  return {
    paypal_fee,
    international_fee,
    conversion_cost,
    platform_fee,
    total_fees,
    net_to_seller: grossMinor - total_fees,
  };
}

/** Variable fee rate in basis points (everything except the fixed fee). */
export function variableFeeBps(ctx: SaleContext): number {
  return (
    FEE_TABLE.paypal_rate_bps +
    (isInternational(ctx) ? FEE_TABLE.international_bps : 0) +
    (needsConversion(ctx) ? FEE_TABLE.conversion_bps : 0) +
    ctx.platformBps
  );
}

/** Estimated PayPal Payouts fee: 2% of the payout, capped per currency. */
export function estimatePayoutFee(amountMinor: number, currency: string): number {
  currencyExponent(currency);
  return Math.min(applyBps(amountMinor, FEE_TABLE.payout_bps), FEE_TABLE.payout_fee_cap_minor[currency as Currency]);
}

/** Smallest payout at which the fee hits its cap (batching beyond this is free). */
export function payoutFeeCapThreshold(currency: string): number {
  currencyExponent(currency);
  return Math.ceil((FEE_TABLE.payout_fee_cap_minor[currency as Currency] * 10_000) / FEE_TABLE.payout_bps);
}
