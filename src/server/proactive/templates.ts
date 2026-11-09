import type { Detection } from "./detectors";

const TITLES: Record<string, string> = {
  fee_spike: "A PayPal fee looks unusually high",
  repeat_refunds: "A buyer has been refunded more than once",
  listing_refund_rate: "A listing is being refunded often",
  failed_payments: "Several payments failed",
  failed_payout: "A payout failed",
  refund_rate_spike: "Refunds are up in one market",
  earnings_drop: "Earnings dropped in one market",
  stuck_pending_payment: "Orders are waiting for payment",
  approval_aging: "Proposals are waiting for your approval",
  payout_ready: "A payout is worth taking now",
  idle_balance: "Money is sitting unpaid",
  fx_drag: "Currency conversion is costing a lot",
  forecast_shift: "Your earnings trend changed",
};

/** Used when the model cannot write the finding: the detector's own sentence, in English. */
export function templateFinding(d: Detection): { title: string; body: string } {
  return { title: TITLES[d.type] ?? "Something needs a look", body: d.summary };
}
