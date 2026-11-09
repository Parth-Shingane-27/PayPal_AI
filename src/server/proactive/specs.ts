import { operationsAgent } from "../agents/operations";
import { PROACTIVE_PROMPT as OPERATIONS_PROACTIVE_PROMPT } from "../agents/operations/proactive-prompt";
import { treasuryAgent } from "../agents/treasury";
import { PROACTIVE_PROMPT as TREASURY_PROACTIVE_PROMPT } from "../agents/treasury/proactive-prompt";
import type { AgentSpec } from "../agents/runtime";

/**
 * Specs for automatic checks, derived from the chat agents so their tools stay
 * in one place. Operations loses propose_refund; Treasury keeps
 * propose_payout_schedule only when the seller opted in. The handoff tool is
 * dropped: an automatic check never changes agent.
 */
export function proactiveSpec(agent: "TREASURY" | "OPERATIONS", opts: { autoPayoutProposals: boolean }): AgentSpec {
  const base = agent === "TREASURY" ? treasuryAgent : operationsAgent;
  const blocked = new Set(["handoff", ...(agent === "OPERATIONS" ? ["propose_refund"] : []), ...(agent === "TREASURY" && !opts.autoPayoutProposals ? ["propose_payout_schedule"] : [])]);
  return {
    ...base,
    system: agent === "TREASURY" ? TREASURY_PROACTIVE_PROMPT : OPERATIONS_PROACTIVE_PROMPT,
    tools: base.tools.filter((t) => !blocked.has(t.name)),
    maxModelCalls: 8,
    timeoutMs: 90_000,
  };
}
