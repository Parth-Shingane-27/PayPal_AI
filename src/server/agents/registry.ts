import type { AgentName } from "@/generated/prisma/client";
import { LISTING_PROMPT, OPERATIONS_PROMPT, SHOPPING_PROMPT, TREASURY_PROMPT } from "./prompts";
import type { AgentSpec } from "./runtime";
import { handoffTool } from "./tools/common";
import { LISTING_TOOLS } from "./tools/listing";
import { OPERATIONS_TOOLS } from "./tools/operations";
import { SHOPPING_TOOLS } from "./tools/shopping";
import { TREASURY_TOOLS } from "./tools/treasury";

/** The four specialists. Tool lists are fixed per agent so the prompt prefix is stable. */
export const AGENTS: Record<AgentName, AgentSpec> = {
  LISTING: {
    name: "LISTING",
    system: LISTING_PROMPT,
    tools: [...LISTING_TOOLS, handoffTool],
    // Localizing many markets takes many steps, and market research ~10-20 s per market.
    maxModelCalls: 40,
    timeoutMs: 5 * 60_000,
  },
  SHOPPING: {
    name: "SHOPPING",
    system: SHOPPING_PROMPT,
    tools: SHOPPING_TOOLS,
    maxModelCalls: 15,
    timeoutMs: 60_000,
  },
  TREASURY: {
    name: "TREASURY",
    system: TREASURY_PROMPT,
    tools: [...TREASURY_TOOLS, handoffTool],
    maxModelCalls: 15,
    timeoutMs: 60_000,
  },
  OPERATIONS: {
    name: "OPERATIONS",
    system: OPERATIONS_PROMPT,
    tools: [...OPERATIONS_TOOLS, handoffTool],
    maxModelCalls: 15,
    timeoutMs: 60_000,
  },
};

export const SELLER_AGENT_NAMES = ["LISTING", "TREASURY", "OPERATIONS"] as const satisfies readonly AgentName[];
