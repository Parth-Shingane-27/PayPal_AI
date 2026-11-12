import type { AgentName } from "@/generated/prisma/client";
import { AppError } from "../errors";
import { hiringAgent } from "./hiring";
import { profileAgent } from "./profile";
import type { AgentSpec } from "./runtime";

/** The two GlobalGig assistants, one folder each: HIRING for clients, PROFILE for freelancers. Tool lists are fixed per agent so the prompt prefix is stable. */
export const AGENTS = {
  PROFILE: profileAgent,
  HIRING: hiringAgent,
} satisfies Partial<Record<AgentName, AgentSpec>>;

export type GigAgentName = keyof typeof AGENTS;

/** The spec for a session's agent. */
export function agentSpec(name: AgentName): AgentSpec {
  const spec = (AGENTS as Partial<Record<AgentName, AgentSpec>>)[name];
  if (!spec) throw new AppError("CONFLICT", "This conversation belongs to an assistant that has been replaced. Please start a new chat.");
  return spec;
}

/** The agent a person gets: one per role. */
export function agentForRole(role: "FREELANCER" | "CLIENT"): GigAgentName {
  return role === "CLIENT" ? "HIRING" : "PROFILE";
}
