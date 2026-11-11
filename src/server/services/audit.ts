import type { AgentName, ActionStatus, Prisma } from "@/generated/prisma/client";
import { type CallContext, PayPalClient, type PayPalCallRecord } from "../clients/paypal";
import { type Db, prisma } from "../db";

/**
 * Every tool call, PayPal call and agent run writes one agent_actions row.
 * Services receive an AuditCtx built from the authenticated session; it never
 * comes from model input.
 */

export type Actor =
  | { type: "FREELANCER"; freelancerId: string }
  | { type: "CLIENT"; clientId: string }
  | { type: "SYSTEM" };

export type AuditCtx = {
  actor: Actor;
  agent?: AgentName | null;
  sessionId?: string | null;
};

export const SYSTEM: AuditCtx = { actor: { type: "SYSTEM" } };

export function actorId(actor: Actor): string | null {
  switch (actor.type) {
    case "FREELANCER":
      return actor.freelancerId;
    case "CLIENT":
      return actor.clientId;
    case "SYSTEM":
      return null;
  }
}

/** The freelancer an audit row belongs to, when the actor is one. */
export function freelancerIdOf(actor: Actor): string | null {
  return actor.type === "FREELANCER" ? actor.freelancerId : null;
}

export function toCallContext(ctx: AuditCtx): CallContext {
  return {
    actor: ctx.actor.type,
    actorId: actorId(ctx.actor),
    freelancerId: freelancerIdOf(ctx.actor),
    sessionId: ctx.sessionId ?? null,
    agent: ctx.agent ?? null,
  };
}

/** JSON-safe copy for Json columns (drops undefined, keeps plain data). */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function recordPayPalCall(ctx: CallContext, r: PayPalCallRecord): Promise<void> {
  await prisma.agentAction.create({
    data: {
      kind: "PAYPAL",
      agent: ctx.agent ?? null,
      tool: `paypal.${r.operation}`,
      input: asJson({ method: r.method, path: r.path, request_id: r.requestId, body: r.request }),
      output: asJson({ http_status: r.httpStatus, body: r.response }),
      status: r.error ? "FAILED" : "SUCCEEDED",
      error: r.error,
      actor: ctx.actor,
      actor_id: ctx.actorId ?? null,
      freelancer_id: ctx.freelancerId ?? null,
      session_id: ctx.sessionId ?? null,
      duration_ms: r.durationMs,
    },
  });
}

/** PayPal call context for GlobalGig money: the audit row belongs to the freelancer whose milestone or payout it is. */
export function gigCallContext(ctx: AuditCtx, freelancerId: string): CallContext {
  return { actor: ctx.actor.type, actorId: actorId(ctx.actor), freelancerId, sessionId: ctx.sessionId ?? null, agent: ctx.agent ?? null };
}

/** The PayPal client every service uses; each call is audited. */
export const paypal = new PayPalClient({ record: recordPayPalCall });

type ToolCallRecord = {
  id?: string;
  tool: string;
  input: unknown;
  output?: unknown;
  status: Extract<ActionStatus, "SUCCEEDED" | "FAILED">;
  error?: string;
  durationMs: number;
  freelancerId?: string | null;
};

export async function recordToolCall(ctx: AuditCtx, r: ToolCallRecord, db: Db = prisma): Promise<void> {
  await db.agentAction.create({
    data: {
      id: r.id,
      kind: "TOOL",
      agent: ctx.agent ?? null,
      tool: r.tool,
      input: asJson(r.input),
      output: r.output === undefined ? undefined : asJson(r.output),
      status: r.status,
      error: r.error,
      actor: ctx.actor.type,
      actor_id: actorId(ctx.actor),
      freelancer_id: r.freelancerId ?? freelancerIdOf(ctx.actor),
      session_id: ctx.sessionId ?? null,
      duration_ms: r.durationMs,
    },
  });
}

export type RunUsage = {
  provider: "groq";
  model: string;
  modelCalls: number;
  /** Prompt tokens not served from cache. */
  input_tokens: number;
  /** Prompt tokens served from the provider's (implicit) cache. */
  cached_input_tokens: number;
  /** Visible output tokens. */
  output_tokens: number;
  /** Thinking tokens (billed as output). */
  thinking_tokens: number;
};

/** One MODEL row per agent run with its token usage. */
export async function recordModelRun(
  ctx: AuditCtx,
  r: { usage: RunUsage; outcome: string; error?: string; durationMs: number; tool?: "model.run" | "model.route" | "model.localize" | "model.market_search" | "model.market_extract" },
): Promise<void> {
  await prisma.agentAction.create({
    data: {
      kind: "MODEL",
      agent: ctx.agent ?? null,
      tool: r.tool ?? "model.run",
      input: asJson({ provider: r.usage.provider, model: r.usage.model }),
      output: asJson({ outcome: r.outcome, usage: r.usage }),
      status: r.error ? "FAILED" : "SUCCEEDED",
      error: r.error,
      actor: ctx.actor.type,
      actor_id: actorId(ctx.actor),
      freelancer_id: freelancerIdOf(ctx.actor),
      session_id: ctx.sessionId ?? null,
      duration_ms: r.durationMs,
    },
  });
}

type ActivityFilter = { freelancerId?: string; sessionIds?: string[]; limit?: number; before?: Date };

/** Timeline rows, newest first. Callers scope the filter to the signed-in actor. */
export async function listActivity(filter: ActivityFilter) {
  const where: Prisma.AgentActionWhereInput = {};
  if (filter.freelancerId) where.freelancer_id = filter.freelancerId;
  if (filter.sessionIds) where.session_id = { in: filter.sessionIds };
  if (filter.before) where.created_at = { lt: filter.before };
  return prisma.agentAction.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: Math.min(filter.limit ?? 100, 500),
  });
}
export type ProposalAction = { id: string; tool: string; input: unknown };
