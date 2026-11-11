import type { AgentAction } from "@/generated/prisma/client";
import { money } from "./domain/money";
import type { listFreelancerApprovals } from "./services/gig/approvals";

/** JSON shapes the UI renders. */

export function activityView(a: AgentAction) {
  const output = (a.output ?? null) as Record<string, unknown> | null;
  return {
    id: a.id,
    kind: a.kind,
    agent: a.agent,
    tool: a.tool,
    status: a.status,
    input: a.input,
    output,
    error: a.error,
    rationale: a.rationale,
    duration_ms: a.duration_ms,
    session_id: a.session_id,
    created_at: a.created_at.toISOString(),
    usage: a.kind === "MODEL" ? (output?.usage ?? null) : null,
  };
}

export function findingView(f: {
  id: string;
  agent: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  status: string;
  session_id: string | null;
  action_id: string | null;
  last_seen_at: Date;
  first_seen_at: Date;
}) {
  return {
    id: f.id,
    agent: f.agent,
    type: f.type,
    severity: f.severity,
    title: f.title,
    body: f.body,
    status: f.status,
    session_id: f.session_id,
    action_id: f.action_id,
    first_seen_at: f.first_seen_at.toISOString(),
    last_seen_at: f.last_seen_at.toISOString(),
  };
}

type GigApprovalRow = Awaited<ReturnType<typeof listFreelancerApprovals>>[number];

/** A freelancer's proposal: a milestone refund or a payout schedule. */
export function gigApprovalView(a: GigApprovalRow, locale: string) {
  const output = (a.output ?? {}) as Record<string, unknown>;
  const { execution, ...proposal } = output;
  const r = a.milestone_refund;
  return {
    id: a.id,
    status: a.status,
    agent: a.agent,
    tool: a.tool,
    rationale: a.rationale,
    error: a.error,
    created_at: a.created_at.toISOString(),
    decided_at: a.decided_at?.toISOString() ?? null,
    proposal,
    execution: execution ?? null,
    refund: r
      ? {
          id: r.id,
          milestone_id: r.milestone_id,
          contract: r.milestone.contract.title,
          milestone: `${r.milestone.position}. ${r.milestone.title}`,
          client: r.milestone.contract.client.company_name ?? r.milestone.contract.client.name,
          status: r.status,
          reason: r.reason,
          from_holding: r.from_holding,
          amount: money(r.amount_minor, r.currency, locale),
          freelancer_debit: r.freelancer_debit_minor === null ? null : money(r.freelancer_debit_minor, r.currency, locale),
          error: r.error,
        }
      : null,
    payouts: a.freelancer_payout_schedule
      ? a.freelancer_payout_schedule.payouts.map((p) => ({
          id: p.id,
          status: p.status,
          date: p.scheduled_for.toISOString().slice(0, 10),
          amount: money(p.amount_minor, p.currency, locale),
          fee: money(p.fee_minor, p.currency, locale),
          fee_is_estimate: p.fee_is_estimate,
          error: p.error,
        }))
      : null,
  };
}
