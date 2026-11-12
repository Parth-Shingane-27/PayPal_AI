import { prisma } from "../../db";
import { estimatePayoutFee, maxPayoutFor, payoutFeeCapThreshold } from "../../domain/fees";
import { money } from "../../domain/money";
import { freelancerLedger } from "../../services/gig/ledger";
import { DAY_MS, HOUR_MS, THRESHOLDS } from "../thresholds";
import type { Detection, Detector } from "./types";

/**
 * The freelancer's detectors: plain code over milestones, balances and
 * approvals. No model is involved in deciding whether something fires.
 */

const clientName = (c: { name: string; company_name: string | null }) => c.company_name ?? c.name;

/** Funded work due within 48h (or overdue) with nothing delivered. */
export const milestoneDueSoon: Detector = async (freelancerId, now) => {
  const until = new Date(now.getTime() + THRESHOLDS.dueSoonHours * HOUR_MS);
  const rows = await prisma.milestone.findMany({
    where: { freelancer_id: freelancerId, state: { in: ["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED"] }, due_date: { lte: until } },
    include: { contract: { select: { title: true, client: { select: { name: true, company_name: true } } } } },
  });
  return rows.map((m) => {
    const hours = Math.round((m.due_date!.getTime() - now.getTime()) / HOUR_MS);
    const overdue = hours < 0;
    return {
      agent: "PROFILE",
      type: "milestone_due_soon",
      subject: m.id,
      severity: overdue ? "HIGH" : "MEDIUM",
      summary: overdue
        ? `"${m.contract.title}" (${m.title}) for ${clientName(m.contract.client)} was due ${Math.abs(Math.round(hours / 24))} day(s) ago and has not been delivered.`
        : `"${m.contract.title}" (${m.title}) for ${clientName(m.contract.client)} is due in about ${hours} hours and has not been delivered.`,
      evidence: { milestone_id: m.id, contract: m.contract.title, milestone: m.title, client: clientName(m.contract.client), due_date: m.due_date!.toISOString().slice(0, 10), state: m.state, hours_left: hours, amount: money(m.amount_minor, m.currency) },
    } satisfies Detection;
  });
};

/** Delivered work waiting for the client, with the auto-release countdown. */
export const awaitingAcceptance: Detector = async (freelancerId, now) => {
  const until = new Date(now.getTime() + THRESHOLDS.autoReleaseWithinHours * HOUR_MS);
  const rows = await prisma.milestone.findMany({
    where: { freelancer_id: freelancerId, state: "DELIVERED", auto_release_at: { lte: until } },
    include: { contract: { select: { title: true, client: { select: { name: true, company_name: true } } } } },
  });
  return rows.map((m) => {
    const hours = Math.max(0, Math.round((m.auto_release_at!.getTime() - now.getTime()) / HOUR_MS));
    return {
      agent: "PROFILE",
      type: "awaiting_acceptance",
      subject: m.id,
      severity: "LOW",
      summary: `${clientName(m.contract.client)} has not accepted "${m.contract.title}" (${m.title}) yet; ${money(m.amount_minor, m.currency).display} releases automatically in about ${hours} hours if they do not respond.`,
      evidence: { milestone_id: m.id, contract: m.contract.title, milestone: m.title, client: clientName(m.contract.client), amount: money(m.amount_minor, m.currency), delivered_at: m.delivered_at?.toISOString() ?? null, auto_release_at: m.auto_release_at!.toISOString(), hours_left: hours },
    } satisfies Detection;
  });
};

/** Payout proposals the freelancer has not decided. */
export const approvalAging: Detector = async (freelancerId, now) => {
  const cutoff = new Date(now.getTime() - THRESHOLDS.approvalAgingDays * DAY_MS);
  const waiting = await prisma.agentAction.findMany({
    where: { freelancer_id: freelancerId, status: "PENDING_APPROVAL", created_at: { lt: cutoff } },
    select: { id: true, tool: true, created_at: true },
  });
  if (waiting.length === 0) return [];
  return [
    {
      agent: "PROFILE",
      type: "approval_aging",
      subject: "all",
      severity: "MEDIUM",
      summary: `${waiting.length} proposal(s) have been waiting for your approval for more than ${THRESHOLDS.approvalAgingDays} days.`,
      evidence: { count: waiting.length, proposals: waiting.slice(0, 10).map((w) => ({ action_id: w.id, tool: w.tool, since: w.created_at.toISOString().slice(0, 10) })) },
    },
  ];
};

/** Released money big enough that one payout reaches the fee cap (batching beyond it is free). */
export const payoutReady: Detector = async (freelancerId) => {
  const out: Detection[] = [];
  for (const l of await freelancerLedger(freelancerId)) {
    const cap = payoutFeeCapThreshold(l.currency);
    if (l.available < cap) continue;
    const payout = maxPayoutFor(l.available, l.currency);
    out.push({
      agent: "PROFILE",
      type: "payout_ready",
      subject: l.currency,
      severity: "LOW",
      summary: `${money(l.available, l.currency).display} is available. A single payout now pays the capped fee of about ${money(estimatePayoutFee(payout, l.currency), l.currency).display}.`,
      evidence: { currency: l.currency, available: money(l.available, l.currency), in_holding: money(l.inHolding, l.currency), fee_cap_threshold: money(cap, l.currency), estimated_fee_is_estimate: true },
    });
  }
  return out;
};

/** Released money sitting unpaid for weeks (the largest one only). */
export const idleBalance: Detector = async (freelancerId, now) => {
  const t = THRESHOLDS.idleBalance;
  const lines = (await freelancerLedger(freelancerId)).sort((a, b) => b.available / payoutFeeCapThreshold(b.currency) - a.available / payoutFeeCapThreshold(a.currency));
  for (const l of lines) {
    if (l.available <= 0 || l.available < payoutFeeCapThreshold(l.currency) * t.minShareOfCapThreshold) continue;
    const [lastPayout, firstRelease] = await Promise.all([
      prisma.freelancerPayout.findFirst({ where: { freelancer_id: freelancerId, currency: l.currency, status: { in: ["PROCESSING", "SUCCESS"] } }, orderBy: { created_at: "desc" }, select: { created_at: true } }),
      prisma.milestonePayment.findFirst({ where: { freelancer_id: freelancerId, currency: l.currency, released_at: { not: null } }, orderBy: { released_at: "asc" }, select: { released_at: true } }),
    ]);
    const since = lastPayout?.created_at ?? firstRelease?.released_at;
    if (!since) continue;
    const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    if (days < t.days) continue;
    return [
      {
        agent: "PROFILE",
        type: "idle_balance",
        subject: l.currency,
        severity: "LOW",
        summary: `${money(l.available, l.currency).display} has been available for ${days} days without a payout.`,
        evidence: { currency: l.currency, available: money(l.available, l.currency), days_since_last_payout_or_first_release: days },
      },
    ];
  }
  return [];
};

/** A client opened a dispute: the money stays in holding until it is resolved. */
export const openDispute: Detector = async (freelancerId) => {
  const rows = await prisma.milestone.findMany({
    where: { freelancer_id: freelancerId, state: "DISPUTED" },
    include: { contract: { select: { title: true, client: { select: { name: true, company_name: true } } } } },
  });
  return rows.map(
    (m) =>
      ({
        agent: "PROFILE",
        type: "open_dispute",
        subject: m.id,
        severity: "HIGH",
        summary: `${clientName(m.contract.client)} disputed "${m.contract.title}" (${m.title}); ${money(m.amount_minor, m.currency).display} stays in holding until it is resolved.`,
        evidence: { milestone_id: m.id, contract: m.contract.title, milestone: m.title, client: clientName(m.contract.client), amount: money(m.amount_minor, m.currency) },
      }) satisfies Detection,
  );
};

export const FREELANCER_DETECTORS: Detector[] = [milestoneDueSoon, awaitingAcceptance, openDispute, approvalAging, payoutReady, idleBalance];
