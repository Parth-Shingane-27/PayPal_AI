import type { AgentName } from "@/generated/prisma/client";
import type { ReasoningEffort } from "../config";
import { prisma } from "../db";
import { getMarket, isMarketLocale } from "../domain/markets";
import { AppError, notFound } from "../errors";
import { buildContext } from "./context";
import type { ModelApi } from "./model";
import { agentForRole, agentSpec } from "./registry";
import { type RunEvent, type RunResult, runAgent } from "./runtime";
import { createSession, getSession, type SessionOwner } from "./sessions";

/**
 * Orchestration is code: each role has exactly one assistant. A client talks
 * to the Client Agent (HIRING), a freelancer to the Freelancer Agent
 * (PROFILE). There is no routing and no handoff.
 */

type OrchestratorEvent = RunEvent | { type: "session"; sessionId: string; agent: AgentName };

type ChatRequest = {
  owner: SessionOwner;
  text: string;
  /** Continue this conversation; omit to start a new one. */
  sessionId?: string | null;
  /** Client market from the session; ignored for freelancers (their own locale applies). */
  marketLocale?: string | null;
  /** The project the person is looking at, so the assistant knows what "this" means. */
  projectId?: string | null;
  onEvent?: (e: OrchestratorEvent) => void;
  deps?: { model?: ModelApi; reasoningEffort?: ReasoningEffort; modelId?: string };
};

export type ChatResponse = {
  sessionId: string;
  agent: AgentName;
  turns: RunResult[];
};

async function localeFor(req: ChatRequest): Promise<string> {
  if (req.owner.type === "FREELANCER") {
    const f = await prisma.freelancer.findUnique({ where: { id: req.owner.freelancerId } });
    if (!f) throw notFound("Freelancer");
    return f.locale;
  }
  const locale = req.marketLocale;
  if (!locale || !isMarketLocale(locale)) throw new AppError("INVALID_INPUT", "Choose a market first.");
  return locale;
}

export async function sendMessage(req: ChatRequest): Promise<ChatResponse> {
  const { owner } = req;
  if (owner.type !== "FREELANCER" && owner.type !== "CLIENT") throw new AppError("FORBIDDEN", "Sign in as a freelancer or a client.");
  const mine = agentForRole(owner.type);

  const session = req.sessionId ? await getSession(req.sessionId, owner) : await createSession(owner, mine, await localeFor(req));
  if (session.agent !== mine) throw notFound("Conversation");
  req.onEvent?.({ type: "session", sessionId: session.id, agent: session.agent });

  const market = getMarket(session.locale);
  const turn = await runAgent({
    owner,
    actor: owner,
    market,
    model: req.deps?.model,
    reasoningEffort: req.deps?.reasoningEffort,
    modelId: req.deps?.modelId,
    onEvent: req.onEvent,
    sessionId: session.id,
    spec: agentSpec(session.agent),
    userText: req.text,
    context: await buildContext(owner, market, { projectId: req.projectId }),
  });
  return { sessionId: session.id, agent: session.agent, turns: [turn] };
}
