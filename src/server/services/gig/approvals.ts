import { randomUUID } from "node:crypto";
import type { AgentAction } from "@/generated/prisma/client";
import type { PayPalApi } from "../../clients/paypal";
import { prisma } from "../../db";
import { AppError, notFound } from "../../errors";
import { schedulePayoutJob } from "../../queue";
import { asJson, type AuditCtx } from "../audit";
import { approveFreelancerPayoutSchedule, proposeFreelancerPayoutSchedule, rejectFreelancerPayoutSchedule } from "./payouts";
import { executeMilestoneRefund, rejectMilestoneRefund } from "./refunds";

/**
 * The freelancer's approval queue: agent_actions rows linked to a milestone
 * refund or a payout schedule. Approving claims the row with a conditional
 * update (PENDING_APPROVAL -> APPROVED) and executes once; approving again
 * returns the recorded outcome. Reachable only from freelancer API routes,
 * never from a tool.
 */

type Decision = { approval_id: string; status: AgentAction["status"]; result?: unknown; error?: string | null; already_decided: boolean };

function decision(row: AgentAction, alreadyDecided: boolean): Decision {
  const out = (row.output ?? {}) as { execution?: unknown };
  return { approval_id: row.id, status: row.status, result: out.execution, error: row.error, already_decided: alreadyDecided };
}

const PROPOSAL = { OR: [{ milestone_refund_id: { not: null } }, { freelancer_payout_schedule_id: { not: null } }] };

async function loadOwned(actionId: string, freelancerId: string) {
  const row = await prisma.agentAction.findFirst({ where: { id: actionId, freelancer_id: freelancerId, ...PROPOSAL } });
  if (!row) throw notFound("Approval");
  return row;
}

export async function approveFreelancerAction(actionId: string, freelancerId: string, deps: { paypal?: PayPalApi } = {}): Promise<Decision> {
  await loadOwned(actionId, freelancerId);
  const claimed = await prisma.agentAction.updateMany({
    where: { id: actionId, freelancer_id: freelancerId, status: "PENDING_APPROVAL", ...PROPOSAL },
    data: { status: "APPROVED", decided_by: freelancerId, decided_at: new Date() },
  });
  const row = await loadOwned(actionId, freelancerId);
  if (claimed.count === 0) {
    if (row.status === "REJECTED") throw new AppError("CONFLICT", "This proposal was already rejected.");
    return decision(row, true);
  }

  const audit: AuditCtx = { actor: { type: "FREELANCER", freelancerId }, agent: row.agent, sessionId: row.session_id };
  let execution: unknown;
  let error: string | null = null;
  try {
    if (row.milestone_refund_id) {
      execution = await executeMilestoneRefund(row.milestone_refund_id, freelancerId, audit, deps.paypal);
    } else if (row.freelancer_payout_schedule_id) {
      const scheduleId = row.freelancer_payout_schedule_id;
      const jobs = await prisma.$transaction((tx) => approveFreelancerPayoutSchedule(tx, scheduleId, freelancerId));
      let queued = true;
      try {
        for (const j of jobs) await schedulePayoutJob(j.id, j.runAt);
      } catch (err) {
        queued = false;
        console.error("payout enqueue failed; the worker will reconcile", err);
      }
      execution = {
        scheduled_payouts: jobs.map((j) => ({ payout_id: j.id, run_at: j.runAt.toISOString() })),
        message: queued ? "Payouts are scheduled and will be sent to PayPal on their dates." : "Payouts are scheduled; the job queue was unavailable, so the worker will queue them within a minute.",
      };
    }
  } catch (err) {
    error = err instanceof AppError ? err.message : "Execution failed unexpectedly. See the server log.";
    if (!(err instanceof AppError)) console.error("approval execution failed", actionId, err);
    if (row.freelancer_payout_schedule_id) {
      const scheduleId = row.freelancer_payout_schedule_id;
      await prisma.$transaction((tx) => rejectFreelancerPayoutSchedule(tx, scheduleId));
    }
  }
  const updated = await prisma.agentAction.update({
    where: { id: row.id },
    data: { status: error ? "EXECUTION_FAILED" : "EXECUTED", error, output: asJson({ ...((row.output as object | null) ?? {}), execution: execution ?? null }) },
  });
  return decision(updated, false);
}

export async function rejectFreelancerAction(actionId: string, freelancerId: string): Promise<Decision> {
  const row = await loadOwned(actionId, freelancerId);
  const done = await prisma.$transaction(async (tx) => {
    const claimed = await tx.agentAction.updateMany({
      where: { id: actionId, freelancer_id: freelancerId, status: "PENDING_APPROVAL" },
      data: { status: "REJECTED", decided_by: freelancerId, decided_at: new Date() },
    });
    if (claimed.count === 0) return false;
    if (row.milestone_refund_id) await rejectMilestoneRefund(tx, row.milestone_refund_id);
    if (row.freelancer_payout_schedule_id) await rejectFreelancerPayoutSchedule(tx, row.freelancer_payout_schedule_id);
    return true;
  });
  const fresh = await loadOwned(actionId, freelancerId);
  if (!done && fresh.status !== "REJECTED") throw new AppError("CONFLICT", `This proposal is already ${fresh.status.toLowerCase()}.`);
  return decision(fresh, !done);
}

export async function listFreelancerApprovals(freelancerId: string) {
  return prisma.agentAction.findMany({
    where: { freelancer_id: freelancerId, ...PROPOSAL },
    orderBy: { created_at: "desc" },
    take: 100,
    include: {
      milestone_refund: { include: { milestone: { select: { title: true, position: true, contract: { select: { title: true, client: { select: { name: true, company_name: true } } } } } } } },
      freelancer_payout_schedule: { include: { payouts: { orderBy: { scheduled_for: "asc" } } } },
    },
  });
}

/**
 * The freelancer's own "Pay out now" click: the click is the approval, so it
 * creates the same proposal an agent would (same balance checks and lock) and
 * approves it at once through the normal path. The audit row has no agent.
 */
export async function payOutNowFreelancer(freelancerId: string, currency: string, now = new Date()) {
  const actionId = randomUUID();
  const input = { currency, payouts: [{ amount: "ALL_AVAILABLE", date: now.toISOString().slice(0, 10) }], rationale: "Payout started by the freelancer from the Earnings page." };
  await proposeFreelancerPayoutSchedule(freelancerId, input, { actor: { type: "FREELANCER", freelancerId }, agent: null }, { id: actionId, tool: "propose_payout_schedule", input }, now);
  return approveFreelancerAction(actionId, freelancerId);
}
