import Groq from "groq-sdk";
import type { ChatCompletionChunk } from "groq-sdk/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { collectStream } from "@/server/agents/model";

type Delta = ChatCompletionChunk.Choice["delta"];
const chunk = (delta: Delta, finish: ChatCompletionChunk.Choice["finish_reason"] = null, extra: Partial<ChatCompletionChunk> = {}): ChatCompletionChunk =>
  ({ id: "c1", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }], ...extra }) as ChatCompletionChunk;

async function* gen(chunks: ChatCompletionChunk[]) {
  for (const c of chunks) yield c;
}

describe("collectStream", () => {
  it("joins the text pieces, reports each one, and returns a normal completion", async () => {
    const seen: string[] = [];
    const res = await collectStream(
      gen([
        chunk({ role: "assistant", content: "" }),
        chunk({ content: "Hel" }),
        chunk({ content: "lo " }),
        chunk({ content: "there" }),
        chunk({}, "stop", { x_groq: { usage: { prompt_tokens: 120, completion_tokens: 9, total_tokens: 129, prompt_tokens_details: { cached_tokens: 100 } } } as ChatCompletionChunk["x_groq"] }),
      ]),
      (t) => seen.push(t),
    );
    expect(seen).toEqual(["Hel", "lo ", "there"]);
    expect(res.choices[0]).toMatchObject({ finish_reason: "stop", message: { role: "assistant", content: "Hello there" } });
    expect(res.choices[0]!.message.tool_calls).toBeUndefined();
    expect(res.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 100 } });
    expect(res.id).toBe("c1");
  });

  it("assembles tool calls from fragments by index, never streams them as text, and keeps parallel calls apart", async () => {
    const seen: string[] = [];
    const res = await collectStream(
      gen([
        chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "get_balances", arguments: "" } }] }),
        chunk({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "query_orders", arguments: '{"limit":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }),
        chunk({ tool_calls: [{ index: 1, function: { arguments: "5}" } }] }),
        chunk({}, "tool_calls"),
      ]),
      (t) => seen.push(t),
    );
    expect(seen).toEqual([]);
    const msg = res.choices[0]!.message;
    expect(res.choices[0]!.finish_reason).toBe("tool_calls");
    expect(msg.content).toBeNull();
    expect(msg.tool_calls).toEqual([
      { id: "call_a", type: "function", function: { name: "get_balances", arguments: "{}" } },
      { id: "call_b", type: "function", function: { name: "query_orders", arguments: '{"limit":5}' } },
    ]);
  });

  it("keeps the finish reason 'length' so the runtime can refuse a cut-off tool call", async () => {
    const res = await collectStream(gen([chunk({ content: "partial" }), chunk({}, "length")]), () => {});
    expect(res.choices[0]).toMatchObject({ finish_reason: "length", message: { content: "partial" } });
  });

  it("returns no choices for an empty stream, which the runtime treats as a refusal", async () => {
    expect((await collectStream(gen([]), () => {})).choices).toEqual([]);
  });

  it("fails when the provider says the stream stopped early", async () => {
    await expect(collectStream(gen([chunk({ content: "x" }), chunk({}, null, { x_groq: { error: "boom" } as ChatCompletionChunk["x_groq"] })]), () => {})).rejects.toThrow(/stopped early/);
  });

  it("turns a streamed tool_use_failed error back into the 400 the runtime retries on", async () => {
    async function* failing(): AsyncGenerator<ChatCompletionChunk> {
      yield chunk({ content: "" });
      throw new Groq.APIError(undefined, { code: "tool_use_failed", message: "bad call" }, "bad call", undefined);
    }
    const err = await collectStream(failing(), () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Groq.BadRequestError);
    expect((err as InstanceType<typeof Groq.BadRequestError>).error).toMatchObject({ code: "tool_use_failed" });
  });

  it("passes other stream errors through unchanged", async () => {
    const original = new Error("network");
    async function* failing(): AsyncGenerator<ChatCompletionChunk> {
      yield chunk({ content: "x" });
      throw original;
    }
    await expect(collectStream(failing(), () => {})).rejects.toBe(original);
  });
});
