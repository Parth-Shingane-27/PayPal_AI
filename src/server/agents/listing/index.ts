import type { AgentSpec } from "../runtime";
import { handoffTool } from "../shared-tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { LISTING_TOOLS } from "./tools";

/** Listing Agent: its prompt, its tools and its run limits. */
export const listingAgent: AgentSpec = {
  name: "LISTING",
  system: SYSTEM_PROMPT,
  tools: [...LISTING_TOOLS, handoffTool],
  // Localizing many markets takes many steps, and market research ~10-20 s per market.
  maxModelCalls: 40,
  timeoutMs: 5 * 60_000,
};
