import Groq from "groq-sdk";
import { z } from "zod";
import { groqConfig } from "../config";
import { AppError } from "../errors";
import { type AuditCtx, recordModelRun } from "../services/audit";
import { groqClient } from "./model";
import { ROUTER_PROMPT } from "./router-prompt";
import { FREELANCER_AGENT_NAMES } from "./registry";
import { jsonSchemaFor } from "./tool";

/**
 * The freelancer "Assistant" box routes each NEW conversation with one Groq
 * structured-output call (strict json_schema). The conversation then stays
 * with the chosen agent.
 */

const routeSchema = z.object({
  agent: z.enum(FREELANCER_AGENT_NAMES),
  reason: z.string(),
});
export type Route = z.infer<typeof routeSchema>;

export type Classifier = (text: string, audit: AuditCtx) => Promise<Route>;

const UNROUTABLE = "I couldn't tell which assistant should handle that. Please open Services, Earnings or Projects directly.";

function groqErrorMessage(err: unknown): string {
  if (err instanceof Groq.RateLimitError) return "The routing service is busy. Please try again shortly, or open a specific assistant.";
  if (err instanceof Groq.AuthenticationError) return "The routing service is not configured correctly (authentication failed).";
  if (err instanceof Groq.BadRequestError) return UNROUTABLE;
  if (err instanceof Groq.APIConnectionError) return "The routing service could not be reached. Please try again or open a specific assistant.";
  if (err instanceof Groq.APIError) return "The routing service returned an error. Please try again or open a specific assistant.";
  throw err;
}

export const classifyWithGroq: Classifier = async (text, audit) => {
  const cfg = groqConfig();
  const started = Date.now();
  let res;
  try {
    res = await groqClient().chat.completions.create({
      model: cfg.GROQ_MODEL,
      messages: [
        { role: "system", content: ROUTER_PROMPT },
        { role: "user", content: text },
      ],
      response_format: { type: "json_schema", json_schema: { name: "route", strict: true, schema: jsonSchemaFor(routeSchema, "route") } },
      reasoning_effort: cfg.GROQ_REASONING_EFFORT,
      max_completion_tokens: 1024,
    });
  } catch (err) {
    console.error("routing call failed", err);
    throw new AppError("UPSTREAM_ERROR", groqErrorMessage(err));
  }
  const u = res.usage;
  await recordModelRun(audit, {
    tool: "model.route",
    usage: {
      provider: "groq",
      model: cfg.GROQ_MODEL,
      modelCalls: 1,
      input_tokens: u?.prompt_tokens ?? 0,
      cached_input_tokens: 0,
      output_tokens: u?.completion_tokens ?? 0,
      thinking_tokens: 0,
    },
    outcome: res.choices[0]?.finish_reason ?? "unknown",
    durationMs: Date.now() - started,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.choices[0]?.message.content ?? "");
  } catch {
    throw new AppError("INVALID_INPUT", UNROUTABLE);
  }
  const route = routeSchema.safeParse(parsed);
  if (!route.success) throw new AppError("INVALID_INPUT", UNROUTABLE);
  return route.data;
};
