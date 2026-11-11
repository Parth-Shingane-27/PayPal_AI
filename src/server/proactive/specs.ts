import type { AgentSpec } from "../agents/runtime";
import { projectsAgent } from "../agents/projects";
import { PROACTIVE_PROMPT as PROJECTS_PROACTIVE_PROMPT } from "../agents/projects/proactive-prompt";
import { treasuryAgent } from "../agents/treasury";
import { PROACTIVE_PROMPT as TREASURY_PROACTIVE_PROMPT } from "../agents/treasury/proactive-prompt";

/**
 * Specs for automatic checks, derived from the chat agents so their tools stay
 * in one place. Projects loses propose_refund; Treasury keeps
 * propose_payout_schedule only when the freelancer opted in. The handoff tool
 * is dropped: an automatic check never changes agent.
 */
export function proactiveSpec(agent: "TREASURY" | "PROJECTS", opts: { autoPayoutProposals: boolean }): AgentSpec {
  const base = agent === "TREASURY" ? treasuryAgent : projectsAgent;
  const blocked = new Set(["handoff", ...(agent === "PROJECTS" ? ["propose_refund"] : []), ...(agent === "TREASURY" && !opts.autoPayoutProposals ? ["propose_payout_schedule"] : [])]);
  return {
    ...base,
    system: agent === "TREASURY" ? TREASURY_PROACTIVE_PROMPT : PROJECTS_PROACTIVE_PROMPT,
    tools: base.tools.filter((t) => !blocked.has(t.name)),
    maxModelCalls: 8,
    timeoutMs: 90_000,
  };
}
