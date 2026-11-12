import type { AgentSpec } from "../runtime";
import { SYSTEM_PROMPT } from "./system-prompt";
import { HIRING_TOOLS } from "./tools";

/** Client Agent (clients only): write a project post, compare the proposals, plan milestones, start payment. */
export const hiringAgent: AgentSpec = {
  name: "HIRING",
  system: SYSTEM_PROMPT,
  tools: HIRING_TOOLS,
  maxModelCalls: 15,
  timeoutMs: 90_000,
};
