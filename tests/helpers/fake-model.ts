import type { ChatCompletion, ChatMessage, ChatRequest, ModelApi } from "@/server/agents/model";

/** One piece of a scripted assistant reply: visible text or a tool call. */
type Piece = { text: string } | { call: { id: string; name: string; args: Record<string, unknown> | string } };

export const text = (t: string): Piece => ({ text: t });
/** A tool call. Pass `args` as a string to script arguments that are not valid JSON. */
export const call = (id: string, name: string, args: Record<string, unknown> | string): Piece => ({ call: { id, name, args } });

type FinishReason = ChatCompletion["choices"][number]["finish_reason"];

/** Builds a Groq chat completion for scripted replies. */
export function reply(
  pieces: Piece[],
  finishReason?: FinishReason,
  extra: { usage?: { prompt_tokens?: number; cached_tokens?: number; completion_tokens?: number; reasoning_tokens?: number }; noChoice?: boolean } = {},
): ChatCompletion {
  const texts = pieces.flatMap((p) => ("text" in p ? [p.text] : []));
  const calls = pieces.flatMap((p) =>
    "call" in p
      ? [{ id: p.call.id, type: "function" as const, function: { name: p.call.name, arguments: typeof p.call.args === "string" ? p.call.args : JSON.stringify(p.call.args) } }]
      : [],
  );
  const u = { prompt_tokens: 100, cached_tokens: 80, completion_tokens: 25, reasoning_tokens: 5, ...extra.usage };
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "openai/gpt-oss-120b",
    choices: extra.noChoice
      ? []
      : [
          {
            index: 0,
            logprobs: null,
            finish_reason: finishReason ?? (calls.length ? "tool_calls" : "stop"),
            message: { role: "assistant", content: texts.length ? texts.join("") : null, ...(calls.length ? { tool_calls: calls } : {}) },
          },
        ],
    usage: {
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      total_tokens: u.prompt_tokens + u.completion_tokens,
      prompt_tokens_details: { cached_tokens: u.cached_tokens },
      completion_tokens_details: { reasoning_tokens: u.reasoning_tokens },
    },
  };
}

/** The request as sent (the AbortSignal is not part of it). */
export type SentRequest = ChatRequest;

type Step = ChatCompletion | Error | ((params: SentRequest) => ChatCompletion | Promise<ChatCompletion>);

/** Replays scripted responses through the real runtime and records every request. */
export function scriptedModel(steps: Step[]) {
  const requests: SentRequest[] = [];
  const model: ModelApi = {
    async chat(params) {
      const sent = structuredClone(params);
      requests.push(sent);
      const step = steps.shift();
      if (step === undefined) throw new Error("scriptedModel: no more scripted responses");
      if (step instanceof Error) throw step;
      return typeof step === "function" ? step(sent) : step;
    },
  };
  return { model, requests };
}

/** The conversation in a request, without the system prompt. */
export function historyIn(req: SentRequest): ChatMessage[] {
  return req.messages.filter((m) => m.role !== "system");
}

/** Tool results sent after the last assistant message, with each call's name and parsed response. */
export function lastResponses(req: SentRequest): { id: string; name: string; response: Record<string, unknown> }[] {
  const lastAssistant = req.messages.findLastIndex((m) => m.role === "assistant");
  const assistant = req.messages[lastAssistant];
  const names = new Map(assistant?.role === "assistant" ? (assistant.tool_calls ?? []).map((c) => [c.id, c.function.name]) : []);
  return req.messages.slice(lastAssistant + 1).flatMap((m) =>
    m.role === "tool" ? [{ id: m.tool_call_id, name: names.get(m.tool_call_id) ?? "", response: JSON.parse(String(m.content)) as Record<string, unknown> }] : [],
  );
}
