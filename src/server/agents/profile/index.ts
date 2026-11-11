import type { AgentSpec } from "../runtime";
import { handoffTool } from "../shared-tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { PROFILE_TOOLS } from "./tools";

/** Profile Agent: services, localized service pages and rates per market. */
export const profileAgent: AgentSpec = {
  name: "PROFILE",
  system: SYSTEM_PROMPT,
  tools: [...PROFILE_TOOLS, handoffTool],
  maxModelCalls: 40,
  timeoutMs: 5 * 60_000,
};
