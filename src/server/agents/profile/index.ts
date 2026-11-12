import type { AgentSpec } from "../runtime";
import { SYSTEM_PROMPT } from "./system-prompt";
import { PROFILE_TOOLS } from "./tools";

/** Freelancer Agent: find projects, price and draft proposals, and explain balances, fees and payouts. */
export const profileAgent: AgentSpec = {
  name: "PROFILE",
  system: SYSTEM_PROMPT,
  tools: PROFILE_TOOLS,
  maxModelCalls: 20,
  timeoutMs: 3 * 60_000,
};
