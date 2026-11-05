import { PayPalApiError, type PayPalApi } from "../clients/paypal";
import { type Db, prisma, type Tx } from "../db";
import { money, parseDecimal } from "../domain/money";
import { AppError, notFound } from "../errors";
import { actorId, asJson, type AuditCtx, paypal as defaultPaypal, toCallContext } from "./audit";
import { lockSeller } from "./locks";

/**
 * Refunds are proposed by the Operations Agent and executed only after a
 * seller approves them. Maths (per the ledger rules):
 *   platform_fee_returned = round(platform_fee * amount / gross)
 *   seller_debit          = amount - paypal_fee_returned - platform_fee_returned
 */

export type ProposalAction = { id: string; tool: string; input: unknown };

/** Refund headroom on a captured payment. Proposals count, so two cannot both claim the full amount. */
async function refundHeadroom(paymentId: string, db: Db = prisma, excludeRefundId?: string) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const refunds = await db.refund.findMany({
    where: { payment_id: paymentId, status: { in: ["PROPOSED", "PENDING", "COMPLETED"] }, ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}) },
  });
  const moved = refunds.filter((r) => r.status !== "PROPOSED").reduce((s, r) => s + r.amount_minor, 0);
  const proposed = refunds.filter((r) => r.status === "PROPOSED").reduce((s, r) => s + r.amount_minor, 0);
  return { payment, gross: payment.gross_minor, refunded: moved, proposed, remaining: payment.gross_minor - moved - proposed };
}

function capturedPayment(db: Db, orderId: string) {
  return db.payment.findFirst({ where: { order_id: orderId, status: "COMPLETED" } });
}

type RefundProposalInput = {
  orderId: string;
  /** Decimal string in the order currency; omitted = everything still refundable. */
  amount?: string;
  reason: string;
  rationale: string;
};

export async function proposeRefund(sellerId: string, input: RefundProposalInput, audit: AuditCtx, action: ProposalAction) {
  const reason = input.reason.trim();
  if (!reason) throw new AppError("INVALID_INPUT", "A refund needs a reason.");

  return prisma.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    const order = await tx.order.findFirst({ where: { id: input.orderId, seller_id: sellerId } });
    if (!order) throw notFound("Order");
    const payment = await capturedPayment(tx, order.id);
    if (!payment) throw new AppError("NOT_REFUNDABLE", "This order has no captured payment, so there is nothing to refund.");

    const h = await refundHeadroom(payment.id, tx);
    const m = (minor: number) => money(minor, payment.currency, order.locale);
    if (h.remaining <= 0) {
      const detail =
        h.proposed > 0
          ? `${m(h.refunded).display} is already refunded and ${m(h.proposed).display} is waiting in another refund proposal.`
          : `It has already been fully refunded (${m(h.refunded).display} of ${m(h.gross).display}).`;
      throw new AppError("NOT_REFUNDABLE", `Nothing left to refund on this order. ${detail}`, {
        gross: m(h.gross),
        refunded: m(h.refunded),
        proposed: m(h.proposed),
      });
    }
    if (payment.capture_id?.startsWith("SEED-")) {
      throw new AppError("NOT_REFUNDABLE", "This order is demo seed data with no real PayPal capture, so it cannot be refunded.");
    }

    const amount = input.amount === undefined ? h.remaining : parseDecimal(input.amount, payment.currency);
    if (amount <= 0) throw new AppError("INVALID_INPUT", "Refund amount must be positive.");
    if (amount > h.remaining) {
      throw new AppError("NOT_REFUNDABLE", `At most ${m(h.remaining).display} can still be refunded on this order.`, {
        remaining: m(h.remaining),
      });
    }

    const refund = await tx.refund.create({
      data: {
        payment_id: payment.id,
        order_id: order.id,
        seller_id: sellerId,
        currency: payment.currency,
        amount_minor: amount,
        reason,
        status: "PROPOSED",
      },
    });
    const output = {
      approval_id: action.id,
      refund_id: refund.id,
      order_id: order.id,
      amount: m(amount),
      full_refund: amount === h.remaining && h.refunded === 0,
      remaining_after: m(h.remaining - amount),
      status: "PENDING_APPROVAL",
      message: "Refund proposed. It will only be sent after the seller approves it on the Approvals page.",
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
        seller_id: sellerId,
        session_id: audit.sessionId ?? null,
        refund_id: refund.id,
      },
    });
    return output;
  });
}

/** Runs an approved refund through PayPal. Called only from the approval flow. */
export async function executeRefund(refundId: string, sellerId: string, audit: AuditCtx, pp: PayPalApi = defaultPaypal) {
  const refund = await prisma.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    const r = await tx.refund.findFirst({ where: { id: refundId, seller_id: sellerId }, include: { payment: true } });
    if (!r) throw notFound("Refund");
    if (r.status !== "PROPOSED") throw new AppError("CONFLICT", `This refund is already ${r.status.toLowerCase()}.`);
    const h = await refundHeadroom(r.payment_id, tx, r.id);
    // At execution only money that actually moved counts against the payment.
    if (r.amount_minor > h.gross - h.refunded) {
      throw new AppError("NOT_REFUNDABLE", "The payment no longer has enough left to refund this amount.");
    }
    if (!r.payment.capture_id || r.payment.capture_id.startsWith("SEED-")) {
      throw new AppError("NOT_REFUNDABLE", "This payment has no real PayPal capture to refund.");
    }
    return r;
  });

  let result;
  try {
    result = await pp.refundCapture(toCallContext(audit, sellerId), {
      captureId: refund.payment.capture_id!,
      amountMinor: refund.amount_minor,
      currency: refund.currency,
      requestId: `refund-${refund.id}`,
      note: refund.reason,
    });
  } catch (err) {
    const message = err instanceof PayPalApiError || err instanceof AppError ? err.message : "PayPal refund failed.";
    await prisma.refund.update({ where: { id: refund.id }, data: { status: "FAILED", error: message } });
    throw new AppError("UPSTREAM_ERROR", `PayPal did not accept the refund: ${message}`);
  }

  const platformFeeReturned = Math.round(((refund.payment.platform_fee_minor ?? 0) * refund.amount_minor) / refund.payment.gross_minor);
  const sellerDebit = refund.amount_minor - result.paypalFeeReturnedMinor - platformFeeReturned;
  const status = result.status === "COMPLETED" ? "COMPLETED" : result.status === "PENDING" ? "PENDING" : "FAILED";

  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status,
        paypal_refund_id: result.refundId,
        paypal_fee_returned_minor: result.paypalFeeReturnedMinor,
        platform_fee_returned_minor: platformFeeReturned,
        seller_debit_minor: sellerDebit,
        completed_at: status === "COMPLETED" ? new Date() : null,
        error: status === "FAILED" ? `PayPal refund status ${result.status}` : null,
      },
    });
    await syncOrderRefundStatus(tx, refund.order_id);
  });

  if (status === "FAILED") throw new AppError("UPSTREAM_ERROR", `PayPal reported the refund as ${result.status}.`);
  const m = (minor: number) => money(minor, refund.currency);
  return {
    refund_id: refund.id,
    paypal_refund_id: result.refundId,
    status,
    amount: m(refund.amount_minor),
    paypal_fee_returned: m(result.paypalFeeReturnedMinor),
    platform_fee_returned: m(platformFeeReturned),
    seller_debit: m(sellerDebit),
  };
}

/** PAID / PARTIALLY_REFUNDED / REFUNDED from the money that actually moved. */
export async function syncOrderRefundStatus(db: Db, orderId: string) {
  const payment = await capturedPayment(db, orderId);
  if (!payment) return;
  const agg = await db.refund.aggregate({
    where: { payment_id: payment.id, status: { in: ["PENDING", "COMPLETED"] } },
    _sum: { amount_minor: true },
  });
  const refunded = agg._sum.amount_minor ?? 0;
  const status = refunded >= payment.gross_minor ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : "PAID";
  await db.order.update({ where: { id: orderId }, data: { status } });
}

export async function rejectRefund(tx: Tx, refundId: string) {
  await tx.refund.updateMany({ where: { id: refundId, status: "PROPOSED" }, data: { status: "REJECTED" } });
}
