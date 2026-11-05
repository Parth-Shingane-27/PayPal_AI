import Groq from "groq-sdk";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
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
  chat(params: ChatRequest, opts?: { signal?: AbortSignal }): Promise<ChatCompletion>;
}

let client: Groq | undefined;

/** Created lazily so GROQ_API_KEY is only required when a model is called. SDK retries (408/409/429/5xx) are capped at 2. */
export function groqClient(): Groq {
  client ??= new Groq({ apiKey: groqConfig().GROQ_API_KEY, maxRetries: 2 });
  return client;
}

export const liveModel: ModelApi = {
  chat: (params, opts) => groqClient().chat.completions.create(params, opts?.signal ? { signal: opts.signal } : undefined),
};
