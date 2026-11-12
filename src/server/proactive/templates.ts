import type { Detection } from "./detectors";

const TITLES: Record<string, string> = {
  milestone_due_soon: "A milestone is due soon",
  awaiting_acceptance: "A delivery is waiting for the client",
  open_dispute: "A client opened a dispute",
  approval_aging: "Proposals are waiting for your approval",
  payout_ready: "A payout is worth taking now",
  idle_balance: "Money is sitting unpaid",
};

/** Used when the model cannot write the finding: the detector's own sentence, in English. */
export function templateFinding(d: Detection): { title: string; body: string } {
  return { title: TITLES[d.type] ?? "Something needs a look", body: d.summary };
}
