import type { AgentSpec } from "../runtime";
import { handoffTool } from "../shared-tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { TREASURY_TOOLS } from "./tools";

/** Treasury Agent: its prompt, its tools and its run limits. */
export const treasuryAgent: AgentSpec = {
  name: "TREASURY",
  system: SYSTEM_PROMPT,
  tools: [...TREASURY_TOOLS, handoffTool],
  maxModelCalls: 15,
  timeoutMs: 60_000,
};
