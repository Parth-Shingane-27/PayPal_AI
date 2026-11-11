import type { Detection } from "./detectors";

const TITLES: Record<string, string> = {
  milestone_due_soon: "A milestone is due soon",
  awaiting_acceptance: "A delivery is waiting for the client",
  revision_loop: "A milestone keeps coming back for revisions",
  open_dispute: "A client opened a dispute",
  refund_rate_spike: "Refunds are up",
  quote_requests_unanswered: "Clients are waiting for your quote",
  approval_aging: "Proposals are waiting for your approval",
  fee_spike: "A PayPal fee looks unusually high",
  repeat_refunds: "A client has been refunded more than once",
  failed_payments: "Several milestone payments failed",
  failed_payout: "A payout failed",
  payout_ready: "A payout is worth taking now",
  idle_balance: "Money is sitting unpaid",
  fx_drag: "Currency conversion is costing a lot",
  forecast_shift: "Your earnings trend changed",
  large_holding_inflow: "A lot of money entered holding this week",
};

/** Used when the model cannot write the finding: the detector's own sentence, in English. */
export function templateFinding(d: Detection): { title: string; body: string } {
  return { title: TITLES[d.type] ?? "Something needs a look", body: d.summary };
}
