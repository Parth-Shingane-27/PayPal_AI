import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyWithGroq } from "@/server/agents/router";
import { prisma } from "@/server/db";
import { makeFreelancer, resetDb } from "../helpers/db";

// Replace the Groq client with a stub; keep the SDK's real error classes.
const create = vi.hoisted(() => vi.fn());
vi.mock("groq-sdk", async (orig) => {
  const actual = await orig<typeof import("groq-sdk")>();
  const Real = actual.default;
  class FakeGroq {
    chat = { completions: { create } };
    static RateLimitError = Real.RateLimitError;
    static AuthenticationError = Real.AuthenticationError;
    static BadRequestError = Real.BadRequestError;
    static APIConnectionError = Real.APIConnectionError;
    static APIError = Real.APIError;
  }
  return { ...actual, default: FakeGroq };
});

beforeEach(async () => {
  await resetDb();
  create.mockReset();
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

const completion = (content: string) => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 },
});

describe("Groq router", () => {
  it("sends a strict json_schema request and returns the validated route", async () => {
    const freelancer = await makeFreelancer();
    create.mockResolvedValue(completion(JSON.stringify({ agent: "TREASURY", reason: "Asks about payouts." })));
    const route = await classifyWithGroq("When should I take a payout?", { actor: { type: "FREELANCER", freelancerId: freelancer.id } });
    expect(route).toEqual({ agent: "TREASURY", reason: "Asks about payouts." });

    const req = create.mock.calls[0]![0];
    expect(req).toMatchObject({ model: "openai/gpt-oss-20b", reasoning_effort: "low", response_format: { type: "json_schema", json_schema: { name: "route", strict: true } } });
    expect(req.response_format.json_schema.schema).toEqual({
      type: "object",
      properties: { agent: { type: "string", enum: ["PROFILE", "TREASURY", "PROJECTS"] }, reason: { type: "string" } },
      required: ["agent", "reason"],
      additionalProperties: false,
    });
    expect(req.messages[1]).toEqual({ role: "user", content: "When should I take a payout?" });
    const row = await prisma.agentAction.findFirstOrThrow({ where: { tool: "model.route" } });
    expect(row.output).toMatchObject({ usage: { provider: "groq", input_tokens: 120, output_tokens: 18 } });
  });

  it("rejects output outside the schema", async () => {
    create.mockResolvedValue(completion(JSON.stringify({ agent: "HIRING", reason: "x" })));
    await expect(classifyWithGroq("hi", { actor: { type: "SYSTEM" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    create.mockResolvedValue(completion("not json"));
    await expect(classifyWithGroq("hi", { actor: { type: "SYSTEM" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("turns a Groq rate limit into a readable upstream error", async () => {
    const { RateLimitError } = await import("groq-sdk");
    create.mockRejectedValue(new RateLimitError(429, { error: { message: "slow down" } }, "rate limited", new Headers()));
    await expect(classifyWithGroq("hi", { actor: { type: "SYSTEM" } })).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: expect.stringContaining("busy") });
  });
});
