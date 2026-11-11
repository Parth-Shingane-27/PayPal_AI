import type { AgentName } from "@/generated/prisma/client";
import { AppError } from "../errors";
import { hiringAgent } from "./hiring";
import { profileAgent } from "./profile";
import { projectsAgent } from "./projects";
import type { AgentSpec } from "./runtime";
import { treasuryAgent } from "./treasury";

/** The four GlobalGig specialists, one folder each. Tool lists are fixed per agent so the prompt prefix is stable. */
export const AGENTS = {
  PROFILE: profileAgent,
  HIRING: hiringAgent,
  TREASURY: treasuryAgent,
  PROJECTS: projectsAgent,
} satisfies Partial<Record<AgentName, AgentSpec>>;

export type GigAgentName = keyof typeof AGENTS;

/** The spec for a session's agent. */
export function agentSpec(name: AgentName): AgentSpec {
  const spec = (AGENTS as Partial<Record<AgentName, AgentSpec>>)[name];
  if (!spec) throw new AppError("CONFLICT", "This conversation belongs to an assistant that has been replaced. Please start a new chat.");
  return spec;
}

/** Agents a freelancer can open or be routed to. Clients only ever reach HIRING. */
export const FREELANCER_AGENT_NAMES = ["PROFILE", "TREASURY", "PROJECTS"] as const satisfies readonly AgentName[];
