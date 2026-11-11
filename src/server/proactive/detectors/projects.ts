import { prisma } from "../../db";
import { money } from "../../domain/money";
import { detectFreelancerAnomalies } from "../../services/gig/insights";
import { DAY_MS, HOUR_MS, THRESHOLDS } from "../thresholds";
import type { Detection, Detector } from "./types";

/**
 * Projects detectors: plain code over milestones, quotes and approvals. No
 * model is involved in deciding whether something fires.
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
      agent: "PROJECTS",
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
      agent: "PROJECTS",
      type: "awaiting_acceptance",
      subject: m.id,
      severity: "LOW",
      summary: `${clientName(m.contract.client)} has not accepted "${m.contract.title}" (${m.title}) yet; ${money(m.amount_minor, m.currency).display} releases automatically in about ${hours} hours if they do not respond.`,
      evidence: { milestone_id: m.id, contract: m.contract.title, milestone: m.title, client: clientName(m.contract.client), amount: money(m.amount_minor, m.currency), delivered_at: m.delivered_at?.toISOString() ?? null, auto_release_at: m.auto_release_at!.toISOString(), hours_left: hours },
    } satisfies Detection;
  });
};

/** Revision loops and open disputes, from the shared anomaly rules. */
export const projectRisks: Detector = async (freelancerId, now) => {
  const { anomalies } = await detectFreelancerAnomalies(freelancerId, "en-US", now);
  const out: Detection[] = [];
  const spikes = anomalies.filter((a) => a.type === "fee_spike");
  if (spikes.length) {
    out.push({ agent: "PROJECTS", type: "fee_spike", subject: "all", severity: "MEDIUM", summary: spikes.length === 1 ? spikes[0]!.summary : `${spikes.length} milestone payments paid a PayPal fee well above your median. ${spikes[0]!.summary}`, evidence: { count: spikes.length, payments: spikes.slice(0, 10).map((a) => a.evidence) } });
  }
  for (const a of anomalies) {
    if (a.type === "fee_spike") continue;
    const e = a.evidence;
    const subject = String(e.milestone_id ?? e.payout_id ?? e.client ?? "all");
    out.push({ agent: "PROJECTS", type: a.type, subject, severity: a.severity.toUpperCase() as Detection["severity"], summary: a.summary, evidence: e });
  }
  return out;
};

/** The share of funded milestones refunded in the last 30 days is well above the 90 days before. */
export const refundRateSpike: Detector = async (freelancerId, now) => {
  const t = THRESHOLDS.refundRate;
  const d30 = new Date(now.getTime() - 30 * DAY_MS);
  const d120 = new Date(now.getTime() - 120 * DAY_MS);
  const [fundedRecent, fundedBase, refundsRecent, refundsBase] = await Promise.all([
    prisma.milestone.count({ where: { freelancer_id: freelancerId, funded_at: { gte: d30, lt: now } } }),
    prisma.milestone.count({ where: { freelancer_id: freelancerId, funded_at: { gte: d120, lt: d30 } } }),
    prisma.milestoneRefund.count({ where: { freelancer_id: freelancerId, status: { in: ["PENDING", "COMPLETED"] }, created_at: { gte: d30, lt: now } } }),
    prisma.milestoneRefund.count({ where: { freelancer_id: freelancerId, status: { in: ["PENDING", "COMPLETED"] }, created_at: { gte: d120, lt: d30 } } }),
  ]);
  if (refundsRecent < t.minRefunds || fundedRecent < t.minMilestones) return [];
  const rate = (refundsRecent / fundedRecent) * 100;
  const base = fundedBase ? (refundsBase / fundedBase) * 100 : 0;
  if (rate < base * t.multiple || rate - base < t.minAbsolutePoints) return [];
  return [
    {
      agent: "PROJECTS",
      type: "refund_rate_spike",
      subject: "all",
      severity: rate >= 40 ? "HIGH" : "MEDIUM",
      summary: `${refundsRecent} refunds against ${fundedRecent} funded milestones in the last 30 days (${Math.round(rate)}%), against about ${Math.round(base)}% before.`,
      evidence: { refunds_last_30_days: refundsRecent, milestones_funded_last_30_days: fundedRecent, refund_rate_percent: Math.round(rate), baseline_rate_percent: Math.round(base) },
    },
  ];
};

/** Clients waiting more than 24h for a price. */
export const unansweredQuotes: Detector = async (freelancerId, now) => {
  const cutoff = new Date(now.getTime() - THRESHOLDS.unansweredQuoteHours * HOUR_MS);
  const rows = await prisma.quote.findMany({
    where: { freelancer_id: freelancerId, status: "REQUESTED", requested_at: { lt: cutoff } },
    include: { client: { select: { name: true, company_name: true } }, service: { select: { title: true } } },
    orderBy: { requested_at: "asc" },
  });
  if (rows.length === 0) return [];
  const oldest = Math.floor((now.getTime() - rows[0]!.requested_at.getTime()) / HOUR_MS);
  return [
    {
      agent: "PROJECTS",
      type: "quote_requests_unanswered",
      subject: "all",
      severity: oldest >= 72 ? "HIGH" : "MEDIUM",
      summary: `${rows.length} quote request(s) have waited more than ${THRESHOLDS.unansweredQuoteHours} hours for a price; the oldest, from ${clientName(rows[0]!.client)}, for ${oldest} hours.`,
      evidence: {
        count: rows.length,
        requests: rows.slice(0, 10).map((q) => ({ quote_id: q.id, client: clientName(q.client), service: q.service?.title ?? null, waiting_hours: Math.floor((now.getTime() - q.requested_at.getTime()) / HOUR_MS) })),
      },
    },
  ];
};

/** Refund and payout proposals the freelancer has not decided. */
export const approvalAging: Detector = async (freelancerId, now) => {
  const cutoff = new Date(now.getTime() - THRESHOLDS.approvalAgingDays * DAY_MS);
  const waiting = await prisma.agentAction.findMany({
    where: { freelancer_id: freelancerId, status: "PENDING_APPROVAL", created_at: { lt: cutoff } },
    select: { id: true, tool: true, created_at: true },
  });
  if (waiting.length === 0) return [];
  return [
    {
      agent: "PROJECTS",
      type: "approval_aging",
      subject: "all",
      severity: "MEDIUM",
      summary: `${waiting.length} proposal(s) have been waiting for your approval for more than ${THRESHOLDS.approvalAgingDays} days.`,
      evidence: { count: waiting.length, proposals: waiting.slice(0, 10).map((w) => ({ action_id: w.id, tool: w.tool, since: w.created_at.toISOString().slice(0, 10) })) },
    },
  ];
};

export const PROJECTS_DETECTORS: Detector[] = [milestoneDueSoon, awaitingAcceptance, projectRisks, refundRateSpike, unansweredQuotes, approvalAging];
