import type { AgentAction } from "@/generated/prisma/client";
import type { PayPalApi } from "../clients/paypal";
import { prisma } from "../db";
import { AppError, notFound } from "../errors";
import { schedulePayoutJob } from "../queue";
import { asJson, type AuditCtx } from "./audit";
import { approvePayoutSchedule, rejectPayoutSchedule } from "./payouts";
import { executeRefund, rejectRefund } from "./refunds";

/**
 * agent_actions is the approval queue. Approving claims the row with a
 * conditional update (PENDING_APPROVAL -> APPROVED), executes, and records
 * EXECUTED or EXECUTION_FAILED. A second approval finds nothing to claim and
 * returns the recorded outcome, so approving twice is harmless.
 *
 * These functions are reachable only from seller API routes, never from a tool.
 */

type Decision = {
  approval_id: string;
  status: AgentAction["status"];
  result?: unknown;
  error?: string | null;
  already_decided: boolean;
};

function decision(row: AgentAction, alreadyDecided: boolean): Decision {
  const out = (row.output ?? {}) as { execution?: unknown };
  return { approval_id: row.id, status: row.status, result: out.execution, error: row.error, already_decided: alreadyDecided };
}

async function loadOwned(actionId: string, sellerId: string) {
  const row = await prisma.agentAction.findFirst({
    where: { id: actionId, seller_id: sellerId, OR: [{ refund_id: { not: null } }, { payout_schedule_id: { not: null } }] },
  });
  if (!row) throw notFound("Approval");
  return row;
}

export async function approveAction(actionId: string, sellerId: string, deps: { paypal?: PayPalApi } = {}): Promise<Decision> {
  const claimed = await prisma.agentAction.updateMany({
    where: { id: actionId, seller_id: sellerId, status: "PENDING_APPROVAL" },
    data: { status: "APPROVED", decided_by: sellerId, decided_at: new Date() },
  });
  const row = await loadOwned(actionId, sellerId);
  if (claimed.count === 0) {
    if (row.status === "REJECTED") throw new AppError("CONFLICT", "This proposal was already rejected.");
    return decision(row, true);
  }

  const audit: AuditCtx = { actor: { type: "SELLER", sellerId }, agent: row.agent, sessionId: row.session_id };
  let execution: unknown;
  let error: string | null = null;
  try {
    if (row.refund_id) {
      execution = await executeRefund(row.refund_id, sellerId, audit, deps.paypal);
    } else if (row.payout_schedule_id) {
      const scheduleId = row.payout_schedule_id;
      const jobs = await prisma.$transaction((tx) => approvePayoutSchedule(tx, scheduleId, sellerId));
      // The payouts are committed as SCHEDULED; the worker also reconciles
      // SCHEDULED payouts into jobs every minute, so a queue hiccup here only
      // delays them and must not report the approval as failed.
      let queued = true;
      try {
        for (const j of jobs) await schedulePayoutJob(j.id, j.runAt);
      } catch (err) {
        queued = false;
        console.error("payout enqueue failed; the worker will reconcile", err);
      }
      execution = {
        scheduled_payouts: jobs.map((j) => ({ payout_id: j.id, run_at: j.runAt.toISOString() })),
        message: queued
          ? "Payouts are scheduled and will be sent to PayPal on their dates."
          : "Payouts are scheduled; the job queue was unavailable, so the worker will queue them within a minute.",
      };
    }
  } catch (err) {
    error = err instanceof AppError ? err.message : "Execution failed unexpectedly. See the server log.";
    if (!(err instanceof AppError)) console.error("approval execution failed", actionId, err);
    if (row.payout_schedule_id) {
      const scheduleId = row.payout_schedule_id;
      await prisma.$transaction((tx) => rejectPayoutSchedule(tx, scheduleId));
    }
  }

  const updated = await prisma.agentAction.update({
    where: { id: row.id },
    data: {
      status: error ? "EXECUTION_FAILED" : "EXECUTED",
      error,
      output: asJson({ ...((row.output as object | null) ?? {}), execution: execution ?? null }),
    },
  });
  return decision(updated, false);
}

export async function rejectAction(actionId: string, sellerId: string): Promise<Decision> {
  const row = await loadOwned(actionId, sellerId);
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.agentAction.updateMany({
      where: { id: actionId, seller_id: sellerId, status: "PENDING_APPROVAL" },
      data: { status: "REJECTED", decided_by: sellerId, decided_at: new Date() },
    });
    if (claimed.count === 0) return false;
    if (row.refund_id) await rejectRefund(tx, row.refund_id);
    if (row.payout_schedule_id) await rejectPayoutSchedule(tx, row.payout_schedule_id);
    return true;
  });
  const fresh = await loadOwned(actionId, sellerId);
  if (!result && fresh.status !== "REJECTED") throw new AppError("CONFLICT", `This proposal is already ${fresh.status.toLowerCase()}.`);
  return decision(fresh, !result);
}

/** Proposals for the approvals page, with the linked refund or payouts. */
export async function listApprovals(sellerId: string) {
  return prisma.agentAction.findMany({
    where: { seller_id: sellerId, OR: [{ refund_id: { not: null } }, { payout_schedule_id: { not: null } }] },
    orderBy: { created_at: "desc" },
    take: 100,
    include: {
      refund: { include: { order: { include: { buyer: { select: { name: true } } } } } },
      payout_schedule: { include: { payouts: { orderBy: { scheduled_for: "asc" } } } },
    },
  });
}
