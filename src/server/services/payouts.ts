import { randomUUID } from "node:crypto";
import { PayPalApiError, type PayoutBatchResult, type PayPalApi } from "../clients/paypal";
import { prisma, type Tx } from "../db";
import { ESTIMATE_NOTE, estimatePayoutFee } from "../domain/fees";
import { money, parseDecimal } from "../domain/money";
import { AppError, notFound } from "../errors";
import { actorId, asJson, type AuditCtx, paypal as defaultPaypal, SYSTEM, toCallContext } from "./audit";
import { availableMinor } from "./ledger";
import { lockSeller } from "./locks";
import type { ProposalAction } from "./refunds";

/**
 * Payouts move the seller's share from the platform's PayPal account to the
 * seller. Agents can only propose a schedule; the seller approves it, then a
 * delayed worker job (job id = payout id) sends each payout and polls PayPal
 * until the batch finishes.
 */

export const MAX_PAYOUTS_PER_SCHEDULE = 6;
const MAX_SCHEDULE_DAYS = 90;

/** Largest payout whose amount + estimated fee fits in `available`. */
export function maxPayoutFor(availableMinorUnits: number, currency: string): number {
  let lo = 0;
  let hi = Math.max(0, availableMinorUnits);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (mid + estimatePayoutFee(mid, currency) <= availableMinorUnits) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function runAt(date: string, now: Date): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("INVALID_INPUT", `Payout dates must be YYYY-MM-DD; got "${date}".`);
  const at = new Date(`${date}T09:00:00.000Z`);
  if (Number.isNaN(at.getTime())) throw new AppError("INVALID_INPUT", `Invalid payout date "${date}".`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (at < today) throw new AppError("INVALID_INPUT", `Payout date ${date} is in the past.`);
  if (at.getTime() - today.getTime() > MAX_SCHEDULE_DAYS * 86_400_000) {
    throw new AppError("INVALID_INPUT", `Payouts can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead.`);
  }
  return at < now ? now : at;
}

type PayoutPlanItem = { amount: string; date: string };

export async function proposePayoutSchedule(
  sellerId: string,
  input: { currency: string; payouts: PayoutPlanItem[]; rationale: string },
  audit: AuditCtx,
  action: ProposalAction,
  now = new Date(),
) {
  if (input.payouts.length === 0) throw new AppError("INVALID_INPUT", "A schedule needs at least one payout.");
  if (input.payouts.length > MAX_PAYOUTS_PER_SCHEDULE) {
    throw new AppError("INVALID_INPUT", `A schedule can have at most ${MAX_PAYOUTS_PER_SCHEDULE} payouts.`);
  }
  const allAvailable = input.payouts.filter((p) => p.amount === "ALL_AVAILABLE").length;
  if (allAvailable > 0 && input.payouts.length > 1) {
    throw new AppError("INVALID_INPUT", "ALL_AVAILABLE can only be used for a single payout.");
  }

  return prisma.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    const seller = await tx.seller.findUniqueOrThrow({ where: { id: sellerId } });
    const available = await availableMinor(sellerId, input.currency, tx);
    const m = (minor: number) => money(minor, input.currency, seller.locale);

    const planned = input.payouts.map((p) => {
      const amount = p.amount === "ALL_AVAILABLE" ? maxPayoutFor(available, input.currency) : parseDecimal(p.amount, input.currency);
      if (amount <= 0) {
        throw new AppError("INSUFFICIENT_FUNDS", `There is no ${input.currency} balance available to pay out.`, { available: m(available) });
      }
      return { amount, fee: estimatePayoutFee(amount, input.currency), at: runAt(p.date, now) };
    });
    const total = planned.reduce((s, p) => s + p.amount + p.fee, 0);
    if (total > available) {
      throw new AppError(
        "INSUFFICIENT_FUNDS",
        `This schedule needs ${m(total).display} including estimated payout fees, but only ${m(available).display} is available.`,
        { needed: m(total), available: m(available) },
      );
    }

    const schedule = await tx.payoutSchedule.create({ data: { seller_id: sellerId, currency: input.currency, status: "PROPOSED" } });
    const payouts = [];
    for (const p of planned) {
      payouts.push(
        await tx.payout.create({
          data: {
            schedule_id: schedule.id,
            seller_id: sellerId,
            currency: input.currency,
            amount_minor: p.amount,
            fee_minor: p.fee,
            fee_is_estimate: true,
            receiver_email: seller.paypal_email,
            scheduled_for: p.at,
            status: "PROPOSED",
            sender_batch_id: `gc-payout-${randomUUID()}`,
          },
        }),
      );
    }
    const output = {
      approval_id: action.id,
      schedule_id: schedule.id,
      currency: input.currency,
      payouts: payouts.map((p) => ({
        payout_id: p.id,
        date: p.scheduled_for.toISOString().slice(0, 10),
        amount: m(p.amount_minor),
        estimated_fee: m(p.fee_minor),
      })),
      total_including_fees: m(total),
      available_now: m(available),
      available_after: m(available - total),
      status: "PENDING_APPROVAL",
      message: "Payout schedule proposed. Nothing is sent until the seller approves it on the Approvals page.",
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
        seller_id: sellerId,
        session_id: audit.sessionId ?? null,
        payout_schedule_id: schedule.id,
      },
    });
    return output;
  });
}

/**
 * Approval step: re-checks the balance under the seller lock (approved
 * payouts are now reserved) and marks the payouts SCHEDULED. Returns payout
 * ids for the caller to enqueue after the transaction commits.
 */
export async function approvePayoutSchedule(tx: Tx, scheduleId: string, sellerId: string) {
  await lockSeller(tx, sellerId);
  const schedule = await tx.payoutSchedule.findFirst({ where: { id: scheduleId, seller_id: sellerId }, include: { payouts: true } });
  if (!schedule) throw notFound("Payout schedule");
  if (schedule.status !== "PROPOSED") throw new AppError("CONFLICT", `This schedule is already ${schedule.status.toLowerCase()}.`);
  const available = await availableMinor(sellerId, schedule.currency, tx);
  const total = schedule.payouts.reduce((s, p) => s + p.amount_minor + p.fee_minor, 0);
  if (total > available) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `The available balance is now ${money(available, schedule.currency).display}, less than the ${money(total, schedule.currency).display} this schedule needs.`,
    );
  }
  await tx.payout.updateMany({ where: { schedule_id: schedule.id, status: "PROPOSED" }, data: { status: "SCHEDULED" } });
  await tx.payoutSchedule.update({ where: { id: schedule.id }, data: { status: "APPROVED" } });
  return schedule.payouts.map((p) => ({ id: p.id, runAt: p.scheduled_for }));
}

export async function rejectPayoutSchedule(tx: Tx, scheduleId: string) {
  await tx.payoutSchedule.updateMany({ where: { id: scheduleId, status: "PROPOSED" }, data: { status: "REJECTED" } });
  await tx.payout.updateMany({ where: { schedule_id: scheduleId, status: "PROPOSED" }, data: { status: "CANCELLED" } });
}

const ITEM_FAILURES = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);

/** Applies a PayPal batch result. Only PROCESSING payouts move forward. */
export async function applyBatchResult(payoutId: string, res: PayoutBatchResult): Promise<"PROCESSING" | "SUCCESS" | "FAILED"> {
  let status: "PROCESSING" | "SUCCESS" | "FAILED";
  if (res.status === "DENIED" || res.status === "CANCELED") status = "FAILED";
  else if (res.status === "SUCCESS") status = res.itemStatus && ITEM_FAILURES.has(res.itemStatus) ? "FAILED" : "SUCCESS";
  else status = "PROCESSING";

  await prisma.payout.updateMany({
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

/**
 * Worker step for one payout. Sends it (idempotent on sender_batch_id) or
 * polls the batch. Returns "POLL" while PayPal is still processing.
 */
export async function runPayout(payoutId: string, pp: PayPalApi = defaultPaypal): Promise<"DONE" | "POLL"> {
  await prisma.payout.updateMany({ where: { id: payoutId, status: "SCHEDULED" }, data: { status: "PROCESSING" } });
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout || payout.status !== "PROCESSING") return "DONE";
  const ctx = toCallContext(SYSTEM, payout.seller_id);

  let res: PayoutBatchResult;
  if (!payout.paypal_batch_id) {
    try {
      res = await pp.createPayout(ctx, {
        senderBatchId: payout.sender_batch_id,
        senderItemId: payout.id,
        receiver: payout.receiver_email,
        amountMinor: payout.amount_minor,
        currency: payout.currency,
        note: "GlobalCart seller payout",
      });
    } catch (err) {
      if (err instanceof PayPalApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        await prisma.payout.updateMany({
          where: { id: payout.id, status: "PROCESSING" },
          data: { status: "FAILED", error: err.message, completed_at: new Date() },
        });
        return "DONE";
      }
      throw err; // transient: the job retries with the same sender_batch_id
    }
  } else {
    res = await pp.getPayoutBatch(ctx, payout.paypal_batch_id, payout.currency);
  }
  return (await applyBatchResult(payout.id, res)) === "PROCESSING" ? "POLL" : "DONE";
}

/**
 * Payouts that need a job: SCHEDULED ones (not yet sent) and PROCESSING ones
 * (still polling). The worker re-enqueues them on boot; job ids dedupe.
 */
export function payoutsNeedingJobs() {
  return prisma.payout.findMany({
    where: { status: { in: ["SCHEDULED", "PROCESSING"] } },
    select: { id: true, status: true, scheduled_for: true },
  });
}
