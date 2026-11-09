import type { AgentSpec } from "../runtime";
import { handoffTool } from "../shared-tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { OPERATIONS_TOOLS } from "./tools";

/** Operations Agent: its prompt, its tools and its run limits. */
export const operationsAgent: AgentSpec = {
  name: "OPERATIONS",
  system: SYSTEM_PROMPT,
  tools: [...OPERATIONS_TOOLS, handoffTool],
  maxModelCalls: 15,
  timeoutMs: 60_000,
};
