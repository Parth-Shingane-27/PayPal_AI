import { randomUUID } from "node:crypto";
import type { PayPalApi } from "../clients/paypal";
import { approveAction } from "./approvals";
import type { AuditCtx } from "./audit";
import { proposePayoutSchedule } from "./payouts";
import { proposeRefund } from "./refunds";

/**
 * One-click seller actions. The seller's click is the human approval, so each
 * creates the same proposal an agent would (same checks: refundable amount,
 * available balance, seller lock) and approves it straight away through the
 * normal approval path (claim once, execute, record). The audit row has no
 * agent, which marks it as done by a person.
 */

export async function refundNow(sellerId: string, input: { orderId: string; amount?: string; reason: string }, deps: { paypal?: PayPalApi } = {}) {
  const actionId = randomUUID();
  const audit: AuditCtx = { actor: { type: "SELLER", sellerId }, agent: null };
  await proposeRefund(
    sellerId,
    { orderId: input.orderId, amount: input.amount, reason: input.reason, rationale: "Refund started by the seller from the Operations page." },
    audit,
    { id: actionId, tool: "propose_refund", input },
  );
  return approveAction(actionId, sellerId, deps);
}

/** Pays out everything available in one currency today (after the estimated payout fee). */
export async function payOutNow(sellerId: string, currency: string, now = new Date()) {
  const actionId = randomUUID();
  const audit: AuditCtx = { actor: { type: "SELLER", sellerId }, agent: null };
  const input = { currency, payouts: [{ amount: "ALL_AVAILABLE", date: now.toISOString().slice(0, 10) }], rationale: "Payout started by the seller from the Treasury page." };
  await proposePayoutSchedule(sellerId, input, audit, { id: actionId, tool: "propose_payout_schedule", input }, now);
  return approveAction(actionId, sellerId);
}
