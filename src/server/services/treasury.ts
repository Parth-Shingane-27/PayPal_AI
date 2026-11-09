import { ESTIMATE_NOTE, estimatePayoutFee, payoutFeeCapThreshold } from "../domain/fees";
import { money } from "../domain/money";
import { forecastEarnings } from "./insights";
import { ledger } from "./ledger";
import { maxPayoutFor } from "./payouts";

/**
 * What the Treasury page draws: per currency, where the money is (earned,
 * refunded, paid out, reserved, available) and how far the available balance
 * is from the size at which one payout's fee stops growing (the cap), plus the
 * 30-day forecast. All amounts are formatted by money(); the fee figures are
 * estimates from the fee table.
 */
export async function treasuryOverview(sellerId: string, locale: string, now = new Date()) {
  const [lines, fc] = await Promise.all([ledger(sellerId), forecastEarnings(sellerId, { horizonDays: 30 }, locale, now)]);
  const cards = lines
    .map((l) => {
      const cap = payoutFeeCapThreshold(l.currency);
      const available = Math.max(0, l.available);
      const payout = maxPayoutFor(available, l.currency);
      const m = (minor: number) => money(minor, l.currency, locale);
      return {
        currency: l.currency,
        earned: m(l.earned),
        refunded: m(l.refunded),
        paid_out: m(l.paidOut),
        reserved: m(l.reserved),
        available: m(l.available),
        /** The available balance at which a single payout's fee reaches its cap. */
        fee_cap_threshold: m(cap),
        until_cap: m(Math.max(0, cap - available)),
        cap_reached: available >= cap,
        payout_amount: m(payout),
        estimated_payout_fee: m(estimatePayoutFee(payout, l.currency)),
        readiness_bps: Math.min(10_000, Math.round((available * 10_000) / cap)),
      };
    })
    // Closest to the cap first: that is the currency worth paying out.
    .sort((a, b) => b.readiness_bps - a.readiness_bps || a.currency.localeCompare(b.currency));
  return { cards, forecasts: fc.forecasts, forecast_method: fc.method, note: ESTIMATE_NOTE };
}
