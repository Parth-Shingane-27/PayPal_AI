import type { AgentSpec } from "../runtime";
import { handoffTool } from "../shared-tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { PROJECTS_TOOLS } from "./tools";

/** Projects Agent: contracts, milestones, deliveries, disputes, refunds and earnings. */
export const projectsAgent: AgentSpec = {
  name: "PROJECTS",
  system: SYSTEM_PROMPT,
  tools: [...PROJECTS_TOOLS, handoffTool],
  maxModelCalls: 15,
  timeoutMs: 60_000,
};
