import type { AgentSpec } from "../agents/runtime";
import { profileAgent } from "../agents/profile";
import { PROACTIVE_PROMPT } from "../agents/profile/proactive-prompt";

/**
 * Spec for automatic checks, derived from the Freelancer Agent so its tools
 * stay in one place. propose_payout_schedule is kept only when the freelancer
 * opted in; an automatic check never sends or drafts a proposal otherwise.
 */
export function proactiveSpec(opts: { autoPayoutProposals: boolean }): AgentSpec {
  const blocked = new Set(opts.autoPayoutProposals ? [] : ["propose_payout_schedule"]);
  return {
    ...profileAgent,
    system: PROACTIVE_PROMPT,
    tools: profileAgent.tools.filter((t) => !blocked.has(t.name)),
    maxModelCalls: 8,
    timeoutMs: 90_000,
  };
}
