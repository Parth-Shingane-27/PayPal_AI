import Groq from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "groq-sdk/resources/chat/completions";
import { groqConfig } from "../config";

/**
 * The one place that talks to Groq. The runtime and the router depend only on
 * ModelApi, so tests replay scripted responses through the real loop.
 */

/** One stored message of an agent conversation (the system prompt is never stored). */
export type ChatMessage = ChatCompletionMessageParam;
export type ChatRequest = ChatCompletionCreateParamsNonStreaming;
export type { ChatCompletion };

export interface ModelApi {
  /**
   * One model call. Always resolves to a complete response. With `onTextDelta`
   * the reply text is also reported piece by piece as it is generated; models
   * that cannot stream may ignore it and just return the whole response.
   */
  chat(params: ChatRequest, opts?: { signal?: AbortSignal; onTextDelta?: (text: string) => void }): Promise<ChatCompletion>;
}

let client: Groq | undefined;

/** Created lazily so GROQ_API_KEY is only required when a model is called. SDK retries (408/409/429/5xx) are capped at 2. */
export function groqClient(): Groq {
  client ??= new Groq({ apiKey: groqConfig().GROQ_API_KEY, maxRetries: 2 });
  return client;
}

/**
 * A malformed tool call arrives as HTTP 400 `tool_use_failed` on a normal call.
 * On a stream it arrives as an error event instead (a status-less APIError), so
 * it is turned back into the BadRequestError the runtime already retries on.
 */
function normalizeStreamError(err: unknown): unknown {
  if (err instanceof Groq.APIError && !(err instanceof Groq.BadRequestError)) {
    const body = err.error as { code?: string } | undefined;
    if (body?.code === "tool_use_failed") return new Groq.BadRequestError(400, err.error, err.message, new Headers());
  }
  return err;
}

/**
 * Reads a chat-completion stream to the end and returns the same shape a
 * non-streaming call would: the full text, the assembled tool calls (their
 * arguments arrive in fragments, keyed by index), the finish reason and usage.
 * Text is passed to `onTextDelta` as it arrives; tool-call fragments never are.
 */
export async function collectStream(stream: AsyncIterable<ChatCompletionChunk>, onTextDelta: (text: string) => void): Promise<ChatCompletion> {
  let id = "";
  let model = "";
  let created = 0;
  let content = "";
  let finish: ChatCompletion["choices"][number]["finish_reason"] | null = null;
  let usage: ChatCompletion["usage"];
  let sawChoice = false;
  const calls = new Map<number, { id: string; name: string; args: string }>();

  try {
    for await (const chunk of stream) {
      id ||= chunk.id;
      model ||= chunk.model;
      created ||= chunk.created;
      if (chunk.x_groq?.error) throw new Error(`The model stream stopped early: ${chunk.x_groq.error}`);
      const u = chunk.x_groq?.usage ?? (chunk as { usage?: ChatCompletion["usage"] }).usage;
      if (u) usage = u;
      const choice = chunk.choices[0];
      if (!choice) continue;
      sawChoice = true;
      const delta = choice.delta;
      if (delta?.content) {
        content += delta.content;
        onTextDelta(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const call = calls.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments) call.args += tc.function.arguments;
        calls.set(tc.index, call);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  } catch (err) {
    throw normalizeStreamError(err);
  }

  const tool_calls: ChatCompletionMessageToolCall[] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c]) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } }));
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: sawChoice
      ? [
          {
            index: 0,
            logprobs: null,
            finish_reason: finish ?? (tool_calls.length > 0 ? "tool_calls" : "stop"),
            message: { role: "assistant", content: content || null, ...(tool_calls.length > 0 ? { tool_calls } : {}) },
          },
        ]
      : [],
    usage,
  } as ChatCompletion;
}

export const liveModel: ModelApi = {
  async chat(params, opts) {
    const reqOpts = opts?.signal ? { signal: opts.signal } : undefined;
    if (!opts?.onTextDelta) return groqClient().chat.completions.create(params, reqOpts);
    const stream = await groqClient().chat.completions.create({ ...params, stream: true }, reqOpts);
    return collectStream(stream, opts.onTextDelta);
  },
};
