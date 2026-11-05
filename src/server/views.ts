import type { AgentAction } from "@/generated/prisma/client";
import { money } from "./domain/money";
import type { listApprovals } from "./services/approvals";

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

type ApprovalRow = Awaited<ReturnType<typeof listApprovals>>[number];

export function approvalView(a: ApprovalRow, locale: string) {
  const output = (a.output ?? {}) as Record<string, unknown>;
  const { execution, ...proposal } = output;
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
    refund: a.refund
      ? {
          id: a.refund.id,
          order_id: a.refund.order_id,
          buyer: a.refund.order.buyer.name,
          status: a.refund.status,
          reason: a.refund.reason,
          amount: money(a.refund.amount_minor, a.refund.currency, locale),
          seller_debit: a.refund.seller_debit_minor === null ? null : money(a.refund.seller_debit_minor, a.refund.currency, locale),
          error: a.refund.error,
        }
      : null,
    payouts: a.payout_schedule
      ? a.payout_schedule.payouts.map((p) => ({
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
