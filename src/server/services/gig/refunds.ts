import { PayPalApiError, type PayPalApi } from "../../clients/paypal";
import { type Db, prisma, type Tx } from "../../db";
import { refundSplit } from "../../domain/balances";
import { isInHolding, isReleased } from "../../domain/milestones";
import { money, parseDecimal } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { actorId, asJson, type AuditCtx, gigCallContext, paypal as defaultPaypal } from "../audit";
import type { ProposalAction } from "../audit";
import { afterRefundCompleted } from "./milestones";
import { lockFreelancer } from "./owner";

/**
 * Milestone refunds. The Projects agent can only PROPOSE one; the freelancer
 * approves it on the Approvals page, and only then does PayPal move money.
 *
 * Rules:
 *  - From holding (milestone not yet released): a full refund in any held
 *    state; a partial refund only while DISPUTED (the rest is then released).
 *    The freelancer is debited nothing: the money never reached them.
 *  - After release (ACCEPTED): partial or full, debited from the freelancer's
 *    released balance.
 */

async function headroom(paymentId: string, db: Db, excludeRefundId?: string) {
  const payment = await db.milestonePayment.findUniqueOrThrow({ where: { id: paymentId } });
  const refunds = await db.milestoneRefund.findMany({
    where: { payment_id: paymentId, status: { in: ["PROPOSED", "PENDING", "COMPLETED"] }, ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}) },
  });
  const moved = refunds.filter((r) => r.status !== "PROPOSED").reduce((s, r) => s + r.amount_minor, 0);
  const proposed = refunds.filter((r) => r.status === "PROPOSED").reduce((s, r) => s + r.amount_minor, 0);
  return { payment, gross: payment.gross_minor, refunded: moved, proposed, remaining: payment.gross_minor - moved - proposed };
}

export async function proposeMilestoneRefund(
  freelancerId: string,
  input: { milestoneId: string; amount?: string; reason: string; rationale: string },
  audit: AuditCtx,
  action: ProposalAction,
) {
  const reason = input.reason.trim();
  if (!reason) throw new AppError("INVALID_INPUT", "A refund needs a reason.");
  return prisma.$transaction(async (tx) => {
    await lockFreelancer(tx, freelancerId);
    const ms = await tx.milestone.findFirst({ where: { id: input.milestoneId, freelancer_id: freelancerId }, include: { contract: { select: { locale: true } } } });
    if (!ms) throw notFound("Milestone");
    const payment = await tx.milestonePayment.findFirst({ where: { milestone_id: ms.id, status: "COMPLETED" } });
    if (!payment || !(isInHolding(ms.state) || isReleased(ms.state))) {
      throw new AppError("NOT_REFUNDABLE", ms.state === "AWAITING_FUNDING" ? "This milestone was never funded, so there is nothing to refund." : `A ${ms.state.toLowerCase().replace(/_/g, " ")} milestone cannot be refunded.`);
    }
    if (payment.capture_id?.startsWith("SEED-")) throw new AppError("NOT_REFUNDABLE", "This milestone is demo seed data with no real PayPal capture, so it cannot be refunded.");
    const fromHolding = !isReleased(ms.state);
    const h = await headroom(payment.id, tx);
    const m = (minor: number) => money(minor, payment.currency, ms.contract.locale);
    if (h.remaining <= 0) {
      throw new AppError("NOT_REFUNDABLE", h.proposed > 0 ? `${m(h.proposed).display} is already waiting in another refund proposal.` : `It has already been fully refunded (${m(h.refunded).display}).`, {
        gross: m(h.gross),
        refunded: m(h.refunded),
        proposed: m(h.proposed),
      });
    }
    const amount = input.amount === undefined ? h.remaining : parseDecimal(input.amount, payment.currency);
    if (amount <= 0) throw new AppError("INVALID_INPUT", "Refund amount must be positive.");
    if (amount > h.remaining) throw new AppError("NOT_REFUNDABLE", `At most ${m(h.remaining).display} can still be refunded on this milestone.`, { remaining: m(h.remaining) });
    if (fromHolding && amount !== h.gross - h.refunded - h.proposed && ms.state !== "DISPUTED") {
      throw new AppError("NOT_REFUNDABLE", "Before the client accepts, a milestone can only be refunded in full, unless it is disputed. Propose the full amount, or wait for the delivery to be accepted.", {
        full_amount: m(h.remaining),
      });
    }

    const refund = await tx.milestoneRefund.create({
      data: {
        payment_id: payment.id,
        milestone_id: ms.id,
        contract_id: ms.contract_id,
        freelancer_id: freelancerId,
        currency: payment.currency,
        amount_minor: amount,
        reason,
        from_holding: fromHolding,
        status: "PROPOSED",
      },
    });
    const full = amount === h.gross - h.refunded;
    const output = {
      approval_id: action.id,
      refund_id: refund.id,
      milestone_id: ms.id,
      amount: m(amount),
      full_refund: full,
      from_holding: fromHolding,
      effect: fromHolding
        ? full
          ? "The client gets the money back from holding; the milestone ends as refunded. Your available balance does not change."
          : "The client gets this part back from holding, and the rest is released to you."
        : "The client gets this amount back; it is debited from your released balance (less the fees PayPal and GlobalGig return).",
      remaining_after: m(h.remaining - amount),
      status: "PENDING_APPROVAL",
      message: "Refund proposed. It is only sent after the freelancer approves it on the Approvals page.",
    };
    await tx.agentAction.create({
      data: {
        id: action.id,
        kind: "TOOL",
        agent: audit.agent ?? null,
        tool: action.tool,
        input: asJson(action.input),
        output: asJson(output),
        status: "PENDING_APPROVAL",
        rationale: input.rationale,
        actor: audit.actor.type,
        actor_id: actorId(audit.actor),
        freelancer_id: freelancerId,
        session_id: audit.sessionId ?? null,
        milestone_refund_id: refund.id,
      },
    });
    return output;
  });
}

/** Runs an approved refund through PayPal. Reached only from the approval flow. */
export async function executeMilestoneRefund(refundId: string, freelancerId: string, audit: AuditCtx, pp: PayPalApi = defaultPaypal) {
  const refund = await prisma.$transaction(async (tx) => {
    await lockFreelancer(tx, freelancerId);
    const r = await tx.milestoneRefund.findFirst({ where: { id: refundId, freelancer_id: freelancerId }, include: { payment: true, milestone: true } });
    if (!r) throw notFound("Refund");
    if (r.status !== "PROPOSED") throw new AppError("CONFLICT", `This refund is already ${r.status.toLowerCase()}.`);
    const h = await headroom(r.payment_id, tx, r.id);
    if (r.amount_minor > h.gross - h.refunded) throw new AppError("NOT_REFUNDABLE", "The payment no longer has enough left to refund this amount.");
    // The milestone may have moved since the proposal (e.g. released): re-check holding.
    if (r.from_holding && !isInHolding(r.milestone.state)) {
      throw new AppError("CONFLICT", `The milestone is now ${r.milestone.state.toLowerCase().replace(/_/g, " ")}; propose the refund again.`);
    }
    if (!r.payment.capture_id || r.payment.capture_id.startsWith("SEED-")) throw new AppError("NOT_REFUNDABLE", "This payment has no real PayPal capture to refund.");
    return r;
  });

  let result;
  try {
    result = await pp.refundCapture(gigCallContext(audit, freelancerId), {
      captureId: refund.payment.capture_id!,
      amountMinor: refund.amount_minor,
      currency: refund.currency,
      requestId: `refund-${refund.id}`,
      note: refund.reason,
    });
  } catch (err) {
    const message = err instanceof PayPalApiError || err instanceof AppError ? err.message : "PayPal refund failed.";
    await prisma.milestoneRefund.update({ where: { id: refund.id }, data: { status: "FAILED", error: message } });
    throw new AppError("UPSTREAM_ERROR", `PayPal did not accept the refund: ${message}`);
  }

  const split = refundSplit({
    amountMinor: refund.amount_minor,
    grossMinor: refund.payment.gross_minor,
    platformFeeMinor: refund.payment.platform_fee_minor ?? 0,
    paypalFeeReturnedMinor: result.paypalFeeReturnedMinor,
    fromHolding: refund.from_holding,
  });
  const status = result.status === "COMPLETED" ? "COMPLETED" : result.status === "PENDING" ? "PENDING" : "FAILED";
  let effect: string | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.milestoneRefund.update({
      where: { id: refund.id },
      data: {
        status,
        paypal_refund_id: result.refundId,
        paypal_fee_returned_minor: result.paypalFeeReturnedMinor,
        platform_fee_returned_minor: split.platformFeeReturnedMinor,
        freelancer_debit_minor: split.freelancerDebitMinor,
        completed_at: status === "COMPLETED" ? new Date() : null,
        error: status === "FAILED" ? `PayPal refund status ${result.status}` : null,
      },
    });
    if (status === "COMPLETED") effect = await afterRefundCompleted(tx, refund.id);
  });
  if (status === "FAILED") throw new AppError("UPSTREAM_ERROR", `PayPal reported the refund as ${result.status}.`);
  const m = (minor: number) => money(minor, refund.currency);
  return {
    refund_id: refund.id,
    paypal_refund_id: result.refundId,
    status,
    amount: m(refund.amount_minor),
    from_holding: refund.from_holding,
    paypal_fee_returned: m(result.paypalFeeReturnedMinor),
    platform_fee_returned: m(split.platformFeeReturnedMinor),
    freelancer_debit: m(split.freelancerDebitMinor),
    milestone_effect: effect,
  };
}

export async function rejectMilestoneRefund(tx: Tx, refundId: string) {
  await tx.milestoneRefund.updateMany({ where: { id: refundId, status: "PROPOSED" }, data: { status: "REJECTED" } });
}
