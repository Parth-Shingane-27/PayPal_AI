import type { AgentName, AgentSession } from "@/generated/prisma/client";
import { prisma } from "../db";
import { AppError, notFound } from "../errors";
import { asJson } from "../services/audit";
import type { ChatMessage } from "./model";

/**
 * agent_sessions hold the full, append-only model history as chat messages
 * (user, assistant with tool_calls, tool results; never the system prompt).
 * A session is
 * locked while a run is in progress (status RUNNING); a second message is
 * rejected until the run finishes. A lock older than STALE_AFTER_MS (a crashed
 * process) can be reclaimed.
 */

const STALE_AFTER_MS = 10 * 60 * 1000;

export type SessionOwner = { type: "SELLER"; sellerId: string } | { type: "BUYER"; buyerId: string };

function ownerWhere(owner: SessionOwner) {
  return owner.type === "SELLER" ? { seller_id: owner.sellerId } : { buyer_id: owner.buyerId };
}

export async function createSession(owner: SessionOwner, agent: AgentName, locale: string, parentId?: string): Promise<AgentSession> {
  return prisma.agentSession.create({
    data: {
      agent,
      actor: owner.type,
      locale,
      parent_id: parentId ?? null,
      ...(owner.type === "SELLER" ? { seller_id: owner.sellerId } : { buyer_id: owner.buyerId }),
    },
  });
}

export async function getSession(sessionId: string, owner: SessionOwner): Promise<AgentSession> {
  const s = await prisma.agentSession.findFirst({ where: { id: sessionId, ...ownerWhere(owner) } });
  if (!s) throw notFound("Conversation");
  return s;
}

export async function listSessions(owner: SessionOwner, agent?: AgentName) {
  return prisma.agentSession.findMany({
    where: { ...ownerWhere(owner), ...(agent ? { agent } : {}) },
    orderBy: { updated_at: "desc" },
    take: 50,
    select: { id: true, agent: true, locale: true, status: true, created_at: true, updated_at: true, parent_id: true },
  });
}

/** A message stored by the earlier Gemini runtime: { role: "user" | "model", parts: [...] }. */
type LegacyContent = { role?: string; parts?: { text?: string; thought?: boolean }[] };

function isLegacy(m: unknown): m is LegacyContent {
  return typeof m === "object" && m !== null && "parts" in m;
}

/**
 * The stored history. Conversations saved by the earlier Gemini runtime are
 * converted to their text turns (tool calls and results are dropped), so they
 * can still be read and continued.
 */
export function historyOf(session: Pick<AgentSession, "messages">): ChatMessage[] {
  const stored = (session.messages ?? []) as unknown[];
  if (!stored.some(isLegacy)) return stored as ChatMessage[];
  const out: ChatMessage[] = [];
  for (const m of stored) {
    if (!isLegacy(m)) continue;
    for (const p of m.parts ?? []) {
      if (typeof p.text !== "string" || p.thought || !p.text.trim()) continue;
      out.push(m.role === "model" ? { role: "assistant", content: p.text } : { role: "user", content: p.text });
    }
  }
  return out;
}

/** Takes the run lock or throws CONFLICT. */
export async function acquireRun(sessionId: string, owner: SessionOwner, now = new Date()): Promise<AgentSession> {
  const claimed = await prisma.agentSession.updateMany({
    where: {
      id: sessionId,
      ...ownerWhere(owner),
      OR: [{ status: "IDLE" }, { status: "RUNNING", run_started_at: { lt: new Date(now.getTime() - STALE_AFTER_MS) } }],
    },
    data: { status: "RUNNING", run_started_at: now },
  });
  if (claimed.count === 0) {
    await getSession(sessionId, owner); // NOT_FOUND for other owners
    throw new AppError("CONFLICT", "A reply is still being written in this conversation. Please wait for it to finish.");
  }
  return getSession(sessionId, owner);
}

/**
 * Replaces the stored history with `messages` in one UPDATE, only while this
 * run still holds the lock. Callers only save complete steps (an assistant
 * tool-call message together with its tool results).
 */
export async function saveHistory(sessionId: string, runStartedAt: Date, messages: ChatMessage[]): Promise<void> {
  const saved = await prisma.agentSession.updateMany({
    where: { id: sessionId, status: "RUNNING", run_started_at: runStartedAt },
    data: { messages: asJson(messages) },
  });
  if (saved.count !== 1) throw new Error(`Lost the run lock on session ${sessionId}`);
}

export async function releaseRun(sessionId: string, runStartedAt: Date): Promise<void> {
  await prisma.agentSession.updateMany({
    where: { id: sessionId, status: "RUNNING", run_started_at: runStartedAt },
    data: { status: "IDLE", run_started_at: null },
  });
}
