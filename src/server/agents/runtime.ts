import { randomUUID } from "node:crypto";
import Groq from "groq-sdk";
import type { ChatCompletionMessageToolCall, ChatCompletionToolMessageParam } from "groq-sdk/resources/chat/completions";
import type { AgentName } from "@/generated/prisma/client";
import { groqConfig, type ReasoningEffort } from "../config";
import type { Market } from "../domain/markets";
import { AppError } from "../errors";
import { type AuditCtx, recordModelRun, recordToolCall, type RunUsage } from "../services/audit";
import { type ChatCompletion, type ChatMessage, liveModel, type ModelApi } from "./model";
import { acquireRun, historyOf, releaseRun, saveHistory, type SessionOwner } from "./sessions";
import { type AnyTool, describeIssues, type ToolCtx, toChatTools } from "./tool";

/**
 * The agent loop, written out by hand so every branch is auditable:
 *   model call -> finish reason -> (run all tool calls in parallel -> one tool
 *   message per call) -> repeat, saving the history after each complete step.
 */

export const MAX_USER_MESSAGE_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 16_000;
const MAX_OUTPUT_TOKENS_RETRY = 32_000;

export type AgentSpec = {
  name: AgentName;
  /** Stable system instruction: no dates, ids or names (keeps implicit caching effective). */
  system: string;
  tools: AnyTool[];
  maxModelCalls: number;
  timeoutMs: number;
};

export type RunEvent =
  | { type: "model_call"; call: number }
  /** A piece of the reply text, as the model writes it. Only sent when a caller listens (the chat), never for background runs. */
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; id: string; name: string; input: unknown }
  | { type: "tool_finished"; id: string; name: string; ok: boolean; durationMs: number; error?: string };

type ToolCallSummary = {
  id: string;
  name: string;
  input: unknown;
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
};

type RunOutcome = "completed" | "refused" | "max_tokens" | "step_limit" | "timeout" | "model_error";

export type RunResult = {
  sessionId: string;
  agent: AgentName;
  reply: string;
  outcome: RunOutcome;
  toolCalls: ToolCallSummary[];
  pendingApprovals: unknown[];
  checkoutLinks: unknown[];
  handoff: { agent: AgentName; summary: string } | null;
  usage: RunUsage;
};

type RunInput = {
  sessionId: string;
  owner: SessionOwner;
  actor: ToolCtx["actor"];
  market: Market;
  spec: AgentSpec;
  userText: string;
  /** Per-conversation facts (date, market, language, names), sent in the first user turn only. */
  context: string;
  /** False for the target of a handoff: one handoff per user message. */
  handoffAllowed?: boolean;
  model?: ModelApi;
  reasoningEffort?: ReasoningEffort;
  modelId?: string;
  onEvent?: (e: RunEvent) => void;
};

const REFUSAL_TEXT = "I'm sorry, but I can't help with that request. Is there something about your shop or your order I can help with?";
const TIMEOUT_TEXT = "This took too long and I stopped. Nothing further was changed; please try again or ask for less at once.";

/** Every failed tool result has the same shape. */
function errorResponse(code: string, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/** Groq answers a malformed tool call with HTTP 400 and code "tool_use_failed"; that one is retried. */
function isToolUseFailed(err: unknown): boolean {
  if (!(err instanceof Groq.BadRequestError)) return false;
  const body = err.error as { code?: string; error?: { code?: string } } | undefined;
  return body?.code === "tool_use_failed" || body?.error?.code === "tool_use_failed";
}

/** A friendly message for a Groq API error, or null for anything else (rethrow it). */
export function modelErrorMessage(err: unknown): string | null {
  if (err instanceof Groq.RateLimitError) return "The assistant is busy right now. Please try again in a minute.";
  if (err instanceof Groq.AuthenticationError || err instanceof Groq.PermissionDeniedError) {
    return "The assistant is not configured correctly (authentication failed). Please tell the site operator.";
  }
  if (err instanceof Groq.BadRequestError) return "The assistant could not process this conversation. Please start a new chat.";
  if (err instanceof Groq.APIConnectionError) return "The assistant service could not be reached. Please try again.";
  if (err instanceof Groq.APIError) return "The assistant service returned an error. Please try again.";
  return null;
}

export async function runAgent(input: RunInput): Promise<RunResult> {
  const text = input.userText.trim();
  if (!text) throw new AppError("INVALID_INPUT", "Please type a message.");
  if (text.length > MAX_USER_MESSAGE_CHARS) {
    throw new AppError("INVALID_INPUT", `Messages are limited to ${MAX_USER_MESSAGE_CHARS} characters.`);
  }

  const model = input.model ?? liveModel;
  const reasoningEffort = input.reasoningEffort ?? groqConfig().GROQ_AGENT_REASONING_EFFORT;
  const modelId = input.modelId ?? groqConfig().GROQ_AGENT_MODEL;
  const { spec } = input;
  const tools = toChatTools(spec.tools);
  const byName = new Map(spec.tools.map((t) => [t.name, t]));
  const audit: AuditCtx = { actor: input.actor, agent: spec.name, sessionId: input.sessionId };

  const session = await acquireRun(input.sessionId, input.owner);
  const lockedAt = session.run_started_at!;
  const started = Date.now();
  const deadline = started + spec.timeoutMs;
  const usage: RunUsage = { provider: "groq", model: modelId, modelCalls: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, thinking_tokens: 0 };
  const toolCalls: ToolCallSummary[] = [];
  const pendingApprovals: unknown[] = [];
  const checkoutLinks: unknown[] = [];
  let handoff: RunResult["handoff"] = null;
  let outcome: RunOutcome = "completed";
  let reply = "";
  let runError: unknown;

  const history = historyOf(session);
  // The session context is its own user message, so the transcript can hide it.
  if (history.length === 0) history.push({ role: "user", content: input.context });
  history.push({ role: "user", content: text });

  try {
    await saveHistory(input.sessionId, lockedAt, history);

    const toolCtx: Omit<ToolCtx, "actionId"> = {
      actor: input.actor,
      locale: input.market.locale,
      market: input.market,
      sessionId: input.sessionId,
      agent: spec.name,
      audit,
    };

    const runTool = async (call: ChatCompletionMessageToolCall): Promise<ChatCompletionToolMessageParam> => {
      const id = randomUUID();
      const name = call.function.name;
      const t0 = Date.now();
      let args: unknown = {};
      const finish = (ok: boolean, response: Record<string, unknown>, extra: { output?: unknown; error?: string }): ChatCompletionToolMessageParam => {
        const durationMs = Date.now() - t0;
        toolCalls.push({ id, name, input: args, ok, durationMs, ...extra });
        input.onEvent?.({ type: "tool_finished", id, name, ok, durationMs, error: extra.error });
        return { role: "tool", tool_call_id: call.id, content: JSON.stringify(response) };
      };

      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = call.function.arguments;
        input.onEvent?.({ type: "tool_started", id, name, input: args });
        const error = `The arguments for ${name} were not valid JSON. Call the tool again with a JSON object.`;
        await recordToolCall(audit, { id, tool: name || "(unnamed)", input: { raw: call.function.arguments }, status: "FAILED", error, durationMs: Date.now() - t0 });
        return finish(false, errorResponse("INVALID_JSON", error), { error });
      }
      input.onEvent?.({ type: "tool_started", id, name, input: args });

      const tool = byName.get(name);
      if (!tool) {
        const error = `Unknown tool "${name}". Use only the tools you were given.`;
        await recordToolCall(audit, { id, tool: name || "(unnamed)", input: args, status: "FAILED", error, durationMs: Date.now() - t0 });
        return finish(false, errorResponse("UNKNOWN_TOOL", error), { error });
      }
      // .strict(): an extra key (say, an injected "freelancer_id") is an error, not silently dropped.
      const parsed = tool.input.strict().safeParse(args);
      if (!parsed.success) {
        const error = `Invalid input for ${tool.name}: ${describeIssues(parsed.error)}. Correct the input and call the tool again.`;
        await recordToolCall(audit, { id, tool: tool.name, input: args, status: "FAILED", error, durationMs: Date.now() - t0 });
        return finish(false, errorResponse("INVALID_INPUT", error), { error });
      }
      if (tool.name === "handoff" && (handoff || input.handoffAllowed === false)) {
        const error = "Only one handoff is allowed per message. Handle this request yourself or tell the user which assistant to ask.";
        await recordToolCall(audit, { id, tool: tool.name, input: parsed.data, status: "FAILED", error, durationMs: Date.now() - t0 });
        return finish(false, errorResponse("HANDOFF_LIMIT", error), { error });
      }

      try {
        const output = await tool.run({ ...toolCtx, actionId: id }, parsed.data);
        // Proposal tools write their own PENDING_APPROVAL row (same transaction as the proposal).
        if (tool.kind !== "proposal") {
          await recordToolCall(audit, { id, tool: tool.name, input: parsed.data, output, status: "SUCCEEDED", durationMs: Date.now() - t0 });
        }
        if (tool.kind === "proposal") pendingApprovals.push(output);
        if (tool.name === "create_milestone_payment") checkoutLinks.push(output);
        if (tool.name === "handoff") handoff = (output as { handoff: NonNullable<RunResult["handoff"]> }).handoff;
        return finish(true, { output }, { output });
      } catch (err) {
        let error: string;
        let response: Record<string, unknown>;
        if (err instanceof AppError) {
          error = err.message;
          response = errorResponse(err.code, err.message, err.details);
        } else {
          console.error(`tool ${tool.name} failed`, err);
          error = err instanceof Error ? err.message : String(err);
          response = errorResponse("INTERNAL", "The tool failed unexpectedly. Tell the user it did not work; do not guess the result.");
        }
        await recordToolCall(audit, { id, tool: tool.name, input: parsed.data, status: "FAILED", error, durationMs: Date.now() - t0 });
        return finish(false, response, { error: err instanceof AppError ? err.message : "The tool failed unexpectedly." });
      }
    };

    let maxOutputTokens = MAX_OUTPUT_TOKENS;
    let badCallRetried = false;
    while (true) {
      if (usage.modelCalls >= spec.maxModelCalls) {
        outcome = "step_limit";
        reply = "I've reached the step limit for one message before finishing. Send another message and I'll continue from here.";
        break;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        outcome = "timeout";
        reply = TIMEOUT_TEXT;
        break;
      }

      usage.modelCalls += 1;
      input.onEvent?.({ type: "model_call", call: usage.modelCalls });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      let response: ChatCompletion;
      try {
        response = await model.chat(
          {
            model: modelId,
            messages: [{ role: "system", content: spec.system }, ...history],
            tools,
            tool_choice: "auto",
            parallel_tool_calls: true,
            reasoning_effort: reasoningEffort,
            // Reasoning is not sent back on later turns, so do not pay to receive it.
            include_reasoning: false,
            max_completion_tokens: maxOutputTokens,
          },
          {
            signal: controller.signal,
            onTextDelta: input.onEvent ? (text) => input.onEvent?.({ type: "text_delta", text }) : undefined,
          },
        );
      } catch (err) {
        if (controller.signal.aborted) {
          outcome = "timeout";
          reply = TIMEOUT_TEXT;
          break;
        }
        if (isToolUseFailed(err)) {
          if (!badCallRetried) {
            badCallRetried = true;
            continue;
          }
          outcome = "model_error";
          reply = "I couldn't form a valid request to my tools, so I stopped before doing anything. Please rephrase or ask for one thing at a time.";
          break;
        }
        const message = modelErrorMessage(err);
        if (message === null) throw err;
        console.error("model call failed", err);
        outcome = "model_error";
        reply = message;
        runError = err;
        break;
      } finally {
        clearTimeout(timer);
      }

      const u = response.usage;
      const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
      const reasoning = u?.completion_tokens_details?.reasoning_tokens ?? 0;
      usage.input_tokens += Math.max(0, (u?.prompt_tokens ?? 0) - cached);
      usage.cached_input_tokens += cached;
      usage.output_tokens += Math.max(0, (u?.completion_tokens ?? 0) - reasoning);
      usage.thinking_tokens += reasoning;

      const choice = response.choices[0];
      if (!choice) {
        outcome = "refused";
        reply = REFUSAL_TEXT;
        break;
      }
      const content = (choice.message.content ?? "").trim();
      const calls = choice.message.tool_calls ?? [];
      const assistant: ChatMessage = calls.length > 0 ? { role: "assistant", content: content || null, tool_calls: calls } : { role: "assistant", content };

      if (choice.finish_reason === "length") {
        if (calls.length > 0) {
          // A tool call cut off mid-arguments must never run. Retry once with more room.
          if (maxOutputTokens === MAX_OUTPUT_TOKENS) {
            maxOutputTokens = MAX_OUTPUT_TOKENS_RETRY;
            continue;
          }
          outcome = "max_tokens";
          reply = "My reply got too long to finish safely, so I stopped before doing anything. Please ask for less at once (for example, fewer markets).";
          break;
        }
        if (content) {
          history.push(assistant);
          await saveHistory(input.sessionId, lockedAt, history);
        }
        outcome = "max_tokens";
        reply = `${content}\n\n(My reply was cut off because it was too long.)`.trim();
        break;
      }

      if (calls.length > 0) {
        history.push(assistant);
        const results = await Promise.all(calls.map(runTool));
        history.push(...results);
        await saveHistory(input.sessionId, lockedAt, history);
        maxOutputTokens = MAX_OUTPUT_TOKENS;
        continue;
      }
      if (content) {
        history.push(assistant);
        await saveHistory(input.sessionId, lockedAt, history);
      }
      reply = content;
      break;
    }
  } catch (err) {
    runError = err;
    throw err;
  } finally {
    await releaseRun(input.sessionId, lockedAt);
    await recordModelRun(audit, {
      usage,
      outcome: runError && outcome === "completed" ? "crashed" : outcome,
      error: runError ? (runError instanceof Error ? runError.message : String(runError)) : undefined,
      durationMs: Date.now() - started,
    }).catch((e: unknown) => console.error("failed to record model run", e));
  }

  if (!reply) reply = toolCalls.length ? "Done." : "I don't have anything to add.";
  return { sessionId: input.sessionId, agent: spec.name, reply, outcome, toolCalls, pendingApprovals, checkoutLinks, handoff, usage };
}
