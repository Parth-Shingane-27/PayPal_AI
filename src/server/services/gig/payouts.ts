import { randomUUID } from "node:crypto";
import { PayPalApiError, type PayoutBatchResult, type PayPalApi } from "../../clients/paypal";
import { prisma, type Tx } from "../../db";
import { ESTIMATE_NOTE, estimatePayoutFee } from "../../domain/fees";
import { money, parseDecimal } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { actorId, asJson, type AuditCtx, gigCallContext, paypal as defaultPaypal, SYSTEM } from "../audit";
import { maxPayoutFor, MAX_PAYOUTS_PER_SCHEDULE } from "../../domain/fees";
import type { ProposalAction } from "../audit";
import { availableFor } from "./ledger";
import { lockFreelancer } from "./owner";

/**
 * Freelancer payouts: released money only (never anything in holding) goes
 * from the platform's PayPal account to the freelancer. Agents only propose a
 * schedule; the freelancer approves it; a delayed worker job sends each
 * payout and polls PayPal until the batch finishes.
 */

const MAX_SCHEDULE_DAYS = 90;

function runAt(date: string, now: Date): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("INVALID_INPUT", `Payout dates must be YYYY-MM-DD; got "${date}".`);
  const at = new Date(`${date}T09:00:00.000Z`);
  if (Number.isNaN(at.getTime())) throw new AppError("INVALID_INPUT", `Invalid payout date "${date}".`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (at < today) throw new AppError("INVALID_INPUT", `Payout date ${date} is in the past.`);
  if (at.getTime() - today.getTime() > MAX_SCHEDULE_DAYS * 86_400_000) throw new AppError("INVALID_INPUT", `Payouts can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead.`);
  return at < now ? now : at;
}

export async function proposeFreelancerPayoutSchedule(
  freelancerId: string,
  input: { currency: string; payouts: { amount: string; date: string }[]; rationale: string },
  audit: AuditCtx,
  action: ProposalAction,
  now = new Date(),
) {
  if (input.payouts.length === 0) throw new AppError("INVALID_INPUT", "A schedule needs at least one payout.");
  if (input.payouts.length > MAX_PAYOUTS_PER_SCHEDULE) throw new AppError("INVALID_INPUT", `A schedule can have at most ${MAX_PAYOUTS_PER_SCHEDULE} payouts.`);
  if (input.payouts.some((p) => p.amount === "ALL_AVAILABLE") && input.payouts.length > 1) throw new AppError("INVALID_INPUT", "ALL_AVAILABLE can only be used for a single payout.");

  return prisma.$transaction(async (tx) => {
    await lockFreelancer(tx, freelancerId);
    const f = await tx.freelancer.findUniqueOrThrow({ where: { id: freelancerId } });
    const available = await availableFor(freelancerId, input.currency, tx);
    const m = (minor: number) => money(minor, input.currency, f.locale);
    const planned = input.payouts.map((p) => {
      const amount = p.amount === "ALL_AVAILABLE" ? maxPayoutFor(available, input.currency) : parseDecimal(p.amount, input.currency);
      if (amount <= 0) {
        throw new AppError("INSUFFICIENT_FUNDS", `There is no released ${input.currency} balance available to pay out. Money in holding becomes available only when clients accept deliveries.`, {
          available: m(available),
        });
      }
      return { amount, fee: estimatePayoutFee(amount, input.currency), at: runAt(p.date, now) };
    });
    const total = planned.reduce((s, p) => s + p.amount + p.fee, 0);
    if (total > available) {
      throw new AppError("INSUFFICIENT_FUNDS", `This schedule needs ${m(total).display} including estimated payout fees, but only ${m(available).display} is available.`, {
        needed: m(total),
        available: m(available),
      });
    }
    const schedule = await tx.freelancerPayoutSchedule.create({ data: { freelancer_id: freelancerId, currency: input.currency, status: "PROPOSED" } });
    const payouts = [];
    for (const p of planned) {
      payouts.push(
        await tx.freelancerPayout.create({
          data: {
            schedule_id: schedule.id,
            freelancer_id: freelancerId,
            currency: input.currency,
            amount_minor: p.amount,
            fee_minor: p.fee,
            fee_is_estimate: true,
            receiver_email: f.paypal_email,
            scheduled_for: p.at,
            status: "PROPOSED",
            sender_batch_id: `gg-payout-${randomUUID()}`,
          },
        }),
      );
    }
    const output = {
      approval_id: action.id,
      schedule_id: schedule.id,
      currency: input.currency,
      payouts: payouts.map((p) => ({ payout_id: p.id, date: p.scheduled_for.toISOString().slice(0, 10), amount: m(p.amount_minor), estimated_fee: m(p.fee_minor) })),
      total_including_fees: m(total),
      available_now: m(available),
      available_after: m(available - total),
      status: "PENDING_APPROVAL",
      message: "Payout schedule proposed. Nothing is sent until the freelancer approves it on the Approvals page.",
      note: ESTIMATE_NOTE,
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
        freelancer_payout_schedule_id: schedule.id,
      },
    });
    return output;
  });
}

/** Approval step: re-checks the released balance under the lock and marks the payouts SCHEDULED. */
export async function approveFreelancerPayoutSchedule(tx: Tx, scheduleId: string, freelancerId: string) {
  await lockFreelancer(tx, freelancerId);
  const schedule = await tx.freelancerPayoutSchedule.findFirst({ where: { id: scheduleId, freelancer_id: freelancerId }, include: { payouts: true } });
  if (!schedule) throw notFound("Payout schedule");
  if (schedule.status !== "PROPOSED") throw new AppError("CONFLICT", `This schedule is already ${schedule.status.toLowerCase()}.`);
  const available = await availableFor(freelancerId, schedule.currency, tx);
  const total = schedule.payouts.reduce((s, p) => s + p.amount_minor + p.fee_minor, 0);
  if (total > available) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `The available balance is now ${money(available, schedule.currency).display}, less than the ${money(total, schedule.currency).display} this schedule needs.`,
    );
  }
  await tx.freelancerPayout.updateMany({ where: { schedule_id: schedule.id, status: "PROPOSED" }, data: { status: "SCHEDULED" } });
  await tx.freelancerPayoutSchedule.update({ where: { id: schedule.id }, data: { status: "APPROVED" } });
  return schedule.payouts.map((p) => ({ id: p.id, runAt: p.scheduled_for }));
}

export async function rejectFreelancerPayoutSchedule(tx: Tx, scheduleId: string) {
  await tx.freelancerPayoutSchedule.updateMany({ where: { id: scheduleId, status: "PROPOSED" }, data: { status: "REJECTED" } });
  await tx.freelancerPayout.updateMany({ where: { schedule_id: scheduleId, status: "PROPOSED" }, data: { status: "CANCELLED" } });
}

const ITEM_FAILURES = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);

export async function applyFreelancerBatchResult(payoutId: string, res: PayoutBatchResult): Promise<"PROCESSING" | "SUCCESS" | "FAILED"> {
  let status: "PROCESSING" | "SUCCESS" | "FAILED";
  if (res.status === "DENIED" || res.status === "CANCELED") status = "FAILED";
  else if (res.status === "SUCCESS") status = res.itemStatus && ITEM_FAILURES.has(res.itemStatus) ? "FAILED" : "SUCCESS";
  else status = "PROCESSING";
  await prisma.freelancerPayout.updateMany({
    where: { id: payoutId, status: "PROCESSING" },
    data: {
      paypal_batch_id: res.batchId,
      status,
      ...(res.feeMinor !== null ? { fee_minor: res.feeMinor, fee_is_estimate: false } : {}),
      ...(status === "FAILED" ? { error: res.itemError ?? `PayPal batch ${res.status}${res.itemStatus ? `, item ${res.itemStatus}` : ""}` } : {}),
      ...(status !== "PROCESSING" ? { completed_at: new Date() } : {}),
    },
  });
  return status;
}

/** Worker step for one payout: send (idempotent on sender_batch_id) or poll. */
export async function runFreelancerPayout(payoutId: string, pp: PayPalApi = defaultPaypal): Promise<"DONE" | "POLL"> {
  await prisma.freelancerPayout.updateMany({ where: { id: payoutId, status: "SCHEDULED" }, data: { status: "PROCESSING" } });
  const payout = await prisma.freelancerPayout.findUnique({ where: { id: payoutId } });
  if (!payout || payout.status !== "PROCESSING") return "DONE";
  const ctx = gigCallContext(SYSTEM, payout.freelancer_id);
  let res: PayoutBatchResult;
  if (!payout.paypal_batch_id) {
    try {
      res = await pp.createPayout(ctx, {
        senderBatchId: payout.sender_batch_id,
        senderItemId: payout.id,
        receiver: payout.receiver_email,
        amountMinor: payout.amount_minor,
        currency: payout.currency,
        note: "GlobalGig freelancer payout",
      });
    } catch (err) {
      if (err instanceof PayPalApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        await prisma.freelancerPayout.updateMany({ where: { id: payout.id, status: "PROCESSING" }, data: { status: "FAILED", error: err.message, completed_at: new Date() } });
        return "DONE";
      }
      throw err;
    }
  } else {
    res = await pp.getPayoutBatch(ctx, payout.paypal_batch_id, payout.currency);
  }
  return (await applyFreelancerBatchResult(payout.id, res)) === "PROCESSING" ? "POLL" : "DONE";
}

export function freelancerPayoutsNeedingJobs() {
  return prisma.freelancerPayout.findMany({ where: { status: { in: ["SCHEDULED", "PROCESSING"] } }, select: { id: true, status: true, scheduled_for: true } });
}
