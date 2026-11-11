/**
 * Pay-on-proof rules. Pure functions: the only thing that decides whether
 * money may be captured and released. No model output, comment or delivery
 * note is ever an input here.
 */

export type CriterionFacts = {
  status: "PENDING" | "PASSED" | "FAILED";
  client_signed_at: Date | null;
  freelancer_signed_at: Date | null;
};

export const CRITERIA_MAX = 12;
export const CRITERION_TEXT_MAX = 300;

/** Locked = both sides signed: the text can no longer change. */
export const isLocked = (c: CriterionFacts) => c.client_signed_at !== null && c.freelancer_signed_at !== null;

/** Work may start once there is at least one criterion and every one is signed by both sides. */
export function canStart(criteria: CriterionFacts[]): { ok: boolean; reason?: string } {
  if (criteria.length === 0) return { ok: false, reason: "Add acceptance criteria and have both sides sign them before work starts." };
  if (!criteria.every(isLocked)) return { ok: false, reason: "Both the client and the freelancer must sign the acceptance criteria before work starts." };
  return { ok: true };
}

/** Accepting (capturing the held payment) needs every criterion marked passed. */
export function canAccept(criteria: CriterionFacts[]): { ok: boolean; reason?: string } {
  if (criteria.length === 0) return { ok: true };
  const open = criteria.filter((c) => c.status !== "PASSED").length;
  if (open > 0) return { ok: false, reason: `${open} acceptance ${open === 1 ? "criterion is" : "criteria are"} not marked passed yet.` };
  return { ok: true };
}

/** The objection window closing releases the money only if nothing was marked failed. */
export function canAutoRelease(criteria: CriterionFacts[]): { ok: boolean; reason?: string } {
  if (criteria.some((c) => c.status === "FAILED")) return { ok: false, reason: "A criterion was marked failed, so the payment stays on hold." };
  return { ok: true };
}
