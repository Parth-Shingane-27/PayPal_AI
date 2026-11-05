import type { AgentName } from "@/generated/prisma/client";
import type { ReasoningEffort } from "../config";
import { prisma } from "../db";
import { getMarket, isMarketLocale } from "../domain/markets";
import { AppError, notFound } from "../errors";
import type { AuditCtx } from "../services/audit";
import { buildContext } from "./context";
import type { ModelApi } from "./model";
import { AGENTS, SELLER_AGENT_NAMES } from "./registry";
import { type Classifier, classifyWithGroq, type Route } from "./router";
import { type RunEvent, type RunResult, runAgent } from "./runtime";
import { createSession, getSession, type SessionOwner } from "./sessions";

/**
 * Orchestration is code, plus one small classifier:
 *  - buyers only ever reach the Shopping Agent;
 *  - seller screens map straight to an agent (editor -> Listing, treasury ->
 *    Treasury, orders -> Operations);
 *  - the seller Assistant box routes a NEW conversation once, then it stays;
 *  - at most one handoff per user message, never back to the same agent.
 */

type OrchestratorEvent =
  | RunEvent
  | { type: "session"; sessionId: string; agent: AgentName }
  | { type: "routed"; agent: AgentName; reason: string }
  | { type: "handoff"; from: AgentName; to: AgentName; sessionId: string };

type ChatRequest = {
  owner: SessionOwner;
  text: string;
  /** Continue this conversation; omit to start a new one. */
  sessionId?: string | null;
  /** Seller screens name their agent; null/undefined in the Assistant box. Ignored for buyers. */
  agent?: AgentName | null;
  /** Buyer market from the session; ignored for sellers (their own locale applies). */
  marketLocale?: string | null;
  /** Listing editor: the product being edited. */
  productId?: string | null;
  onEvent?: (e: OrchestratorEvent) => void;
  deps?: { model?: ModelApi; classify?: Classifier; reasoningEffort?: ReasoningEffort; modelId?: string };
};

export type ChatResponse = {
  sessionId: string;
  agent: AgentName;
  routed: Route | null;
  turns: RunResult[];
  handoff: { from: AgentName; to: AgentName; sessionId: string } | null;
};

async function localeFor(req: ChatRequest): Promise<string> {
  if (req.owner.type === "SELLER") {
    const seller = await prisma.seller.findUnique({ where: { id: req.owner.sellerId } });
    if (!seller) throw notFound("Seller");
    return seller.locale;
  }
  const locale = req.marketLocale;
  if (!locale || !isMarketLocale(locale)) throw new AppError("INVALID_INPUT", "Choose a market first.");
  return locale;
}

export async function sendMessage(req: ChatRequest): Promise<ChatResponse> {
  const { owner } = req;
  const audit: AuditCtx = { actor: owner, agent: null, sessionId: null };
  let routed: Route | null = null;

  let session;
  if (req.sessionId) {
    session = await getSession(req.sessionId, owner);
  } else {
    let agent: AgentName;
    if (owner.type === "BUYER") {
      agent = "SHOPPING";
    } else if (req.agent) {
      if (!(SELLER_AGENT_NAMES as readonly string[]).includes(req.agent)) throw new AppError("FORBIDDEN", "That assistant is not available to sellers.");
      agent = req.agent;
    } else {
      routed = await (req.deps?.classify ?? classifyWithGroq)(req.text, audit);
      agent = routed.agent;
      req.onEvent?.({ type: "routed", agent: routed.agent, reason: routed.reason });
    }
    session = await createSession(owner, agent, await localeFor(req));
  }
  if (owner.type === "BUYER" && session.agent !== "SHOPPING") throw notFound("Conversation");
  req.onEvent?.({ type: "session", sessionId: session.id, agent: session.agent });

  const market = getMarket(session.locale);
  const actor = owner;
  const base = { owner, actor, market, model: req.deps?.model, reasoningEffort: req.deps?.reasoningEffort, modelId: req.deps?.modelId, onEvent: req.onEvent };

  const first = await runAgent({
    ...base,
    sessionId: session.id,
    spec: AGENTS[session.agent],
    userText: req.text,
    context: await buildContext(owner, market, { productId: req.productId }),
  });

  if (!first.handoff || owner.type !== "SELLER" || first.handoff.agent === session.agent) {
    return { sessionId: session.id, agent: session.agent, routed, turns: [first], handoff: null };
  }

  const to = first.handoff.agent;
  const child = await createSession(owner, to, session.locale, session.id);
  req.onEvent?.({ type: "handoff", from: session.agent, to, sessionId: child.id });
  const second = await runAgent({
    ...base,
    sessionId: child.id,
    spec: AGENTS[to],
    userText: req.text,
    context: await buildContext(owner, market, { handoff: { from: session.agent, summary: first.handoff.summary } }),
    handoffAllowed: false,
  });
  return {
    sessionId: child.id,
    agent: to,
    routed,
    turns: [first, second],
    handoff: { from: session.agent, to, sessionId: child.id },
  };
}
