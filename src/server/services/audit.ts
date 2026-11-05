import type { AgentName, ActionStatus, Prisma } from "@/generated/prisma/client";
import { type CallContext, PayPalClient, type PayPalCallRecord } from "../clients/paypal";
import { type Db, prisma } from "../db";

/**
 * Every tool call, PayPal call and agent run writes one agent_actions row.
 * Services receive an AuditCtx built from the authenticated session; it never
 * comes from model input.
 */

export type Actor = { type: "SELLER"; sellerId: string } | { type: "BUYER"; buyerId: string } | { type: "SYSTEM" };

export type AuditCtx = {
  actor: Actor;
  agent?: AgentName | null;
  sessionId?: string | null;
};

export const SYSTEM: AuditCtx = { actor: { type: "SYSTEM" } };

export function actorId(actor: Actor): string | null {
  return actor.type === "SELLER" ? actor.sellerId : actor.type === "BUYER" ? actor.buyerId : null;
}

export function toCallContext(ctx: AuditCtx, sellerId?: string | null): CallContext {
  return {
    actor: ctx.actor.type,
    actorId: actorId(ctx.actor),
    sellerId: sellerId ?? (ctx.actor.type === "SELLER" ? ctx.actor.sellerId : null),
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
      seller_id: ctx.sellerId ?? null,
      session_id: ctx.sessionId ?? null,
      duration_ms: r.durationMs,
    },
  });
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
  sellerId?: string | null;
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
      seller_id: r.sellerId ?? (ctx.actor.type === "SELLER" ? ctx.actor.sellerId : null),
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
  r: { usage: RunUsage; outcome: string; error?: string; durationMs: number; tool?: "model.run" | "model.route" | "model.localize" },
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
      seller_id: ctx.actor.type === "SELLER" ? ctx.actor.sellerId : null,
      session_id: ctx.sessionId ?? null,
      duration_ms: r.durationMs,
    },
  });
}

type ActivityFilter = { sellerId?: string; sessionIds?: string[]; limit?: number; before?: Date };

/** Timeline rows, newest first. Callers scope the filter to the signed-in actor. */
export async function listActivity(filter: ActivityFilter) {
  const where: Prisma.AgentActionWhereInput = {};
  if (filter.sellerId) where.seller_id = filter.sellerId;
  if (filter.sessionIds) where.session_id = { in: filter.sessionIds };
  if (filter.before) where.created_at = { lt: filter.before };
  return prisma.agentAction.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: Math.min(filter.limit ?? 100, 500),
  });
}
