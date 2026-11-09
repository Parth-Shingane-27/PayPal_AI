import type { AgentName } from "@/generated/prisma/client";
import { listingAgent } from "./listing";
import { operationsAgent } from "./operations";
import type { AgentSpec } from "./runtime";
import { shoppingAgent } from "./shopping";
import { treasuryAgent } from "./treasury";

/** The four specialists, one folder each. Tool lists are fixed per agent so the prompt prefix is stable. */
export const AGENTS: Record<AgentName, AgentSpec> = {
  LISTING: listingAgent,
  SHOPPING: shoppingAgent,
  TREASURY: treasuryAgent,
  OPERATIONS: operationsAgent,
};

export const SELLER_AGENT_NAMES = ["LISTING", "TREASURY", "OPERATIONS"] as const satisfies readonly AgentName[];
