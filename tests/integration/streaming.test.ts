import { beforeEach, describe, expect, it } from "vitest";
import type { ChatCompletion, ModelApi } from "@/server/agents/model";
import { type AgentSpec, type RunEvent, runAgent } from "@/server/agents/runtime";
import { createSession, historyOf } from "@/server/agents/sessions";
import { PROFILE_TOOLS } from "@/server/agents/profile/tools";
import { prisma } from "@/server/db";
import { getMarket } from "@/server/domain/markets";
import { makeFreelancer, resetDb } from "../helpers/db";
import { call, reply, text } from "../helpers/fake-model";

beforeEach(resetDb);

const SPEC: AgentSpec = { name: "PROFILE", system: "You are a test agent.", tools: PROFILE_TOOLS, maxModelCalls: 10, timeoutMs: 30_000 };
const CONTEXT = "<session_context>Today is 2026-11-04.</session_context>";

type Step = { deltas: string[]; response: ChatCompletion };

/** A model that, like the live one, reports its text piece by piece when asked to and returns the whole response. */
function streamingModel(steps: Step[]) {
  const asked: boolean[] = [];
  const model: ModelApi = {
    async chat(_params, opts) {
      asked.push(Boolean(opts?.onTextDelta));
      const step = steps.shift();
      if (!step) throw new Error("no more scripted steps");
      for (const d of step.deltas) opts?.onTextDelta?.(d);
      return step.response;
    },
  };
  return { model, asked };
}

async function run(model: ModelApi, onEvent?: (e: RunEvent) => void) {
  const freelancer = await makeFreelancer();
  const owner = { type: "FREELANCER" as const, freelancerId: freelancer.id };
  const session = await createSession(owner, "PROFILE", "en-US");
  const result = await runAgent({
    sessionId: session.id,
    owner,
    actor: owner,
    market: getMarket("en-US"),
    spec: SPEC,
    userText: "How much can I pay out?",
    context: CONTEXT,
    model,
    reasoningEffort: "medium",
    modelId: "openai/gpt-oss-120b",
    onEvent,
  });
  const stored = historyOf(await prisma.agentSession.findUniqueOrThrow({ where: { id: session.id } }));
  return { result, stored };
}

describe("streaming the reply", () => {
  it("emits the text as it is written and still returns the complete reply", async () => {
    const full = "You have **$129.57** available.";
    const { model } = streamingModel([{ deltas: ["You have ", "**$129.57** ", "available."], response: reply([text(full)]) }]);
    const events: RunEvent[] = [];
    const { result, stored } = await run(model, (e) => events.push(e));

    expect(events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join("")).toBe(full);
    expect(result.reply).toBe(full);
    expect(result.outcome).toBe("completed");
    expect(stored.at(-1)).toMatchObject({ role: "assistant", content: full });
  });

  it("starts a fresh turn after each model call, so text before a tool call is never mixed into the answer", async () => {
    const { model } = streamingModel([
      { deltas: ["Let me check."], response: reply([text("Let me check."), call("c1", "get_balances", {})]) },
      { deltas: ["You have ", "$10."], response: reply([text("You have $10.")]) },
    ]);
    const events: RunEvent[] = [];
    const { result } = await run(model, (e) => events.push(e));

    const shape = events.filter((e) => ["model_call", "text_delta", "tool_started", "tool_finished"].includes(e.type)).map((e) => (e.type === "text_delta" ? `text:${(e as { text: string }).text}` : e.type));
    expect(shape).toEqual(["model_call", "text:Let me check.", "tool_started", "tool_finished", "model_call", "text:You have ", "text:$10."]);
    expect(result.reply).toBe("You have $10.");
  });

  it("does not ask for streaming when nobody is listening (background runs)", async () => {
    const { model, asked } = streamingModel([{ deltas: ["ignored"], response: reply([text("Done.")]) }]);
    const { result } = await run(model);
    expect(asked).toEqual([false]);
    expect(result.reply).toBe("Done.");
  });
});
