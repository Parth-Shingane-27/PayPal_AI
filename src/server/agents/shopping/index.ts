import type { AgentSpec } from "../runtime";
import { SYSTEM_PROMPT } from "./system-prompt";
import { SHOPPING_TOOLS } from "./tools";

/** Shopping Agent: its prompt, its tools and its run limits. */
export const shoppingAgent: AgentSpec = {
  name: "SHOPPING",
  system: SYSTEM_PROMPT,
  tools: SHOPPING_TOOLS,
  maxModelCalls: 15,
  timeoutMs: 60_000,
};
