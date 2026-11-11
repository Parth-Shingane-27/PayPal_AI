import { z } from "zod";
import { AppError } from "../errors";
import type { GigOwner } from "../services/gig/owner";
import { defineTool, type ToolCtx } from "./tool";

/** The freelancer id from the session; freelancer tools never take it as input. */
export function freelancerOf(ctx: ToolCtx): string {
  if (ctx.actor.type !== "FREELANCER") throw new AppError("FORBIDDEN", "This tool is only available to freelancers.");
  return ctx.actor.freelancerId;
}

export function clientOf(ctx: ToolCtx): string {
  if (ctx.actor.type !== "CLIENT") throw new AppError("FORBIDDEN", "This tool is only available to clients.");
  return ctx.actor.clientId;
}

/** The session's freelancer or client, as the GlobalGig services expect it. */
export function ownerOf(ctx: ToolCtx): GigOwner {
  if (ctx.actor.type === "FREELANCER") return { type: "FREELANCER", freelancerId: ctx.actor.freelancerId, locale: ctx.locale };
  if (ctx.actor.type === "CLIENT") return { type: "CLIENT", clientId: ctx.actor.clientId, locale: ctx.locale };
  throw new AppError("FORBIDDEN", "This tool is only available on GlobalGig.");
}

export const uuid = () => z.uuid();

/** Decimal money as the user wrote it, e.g. "49.99" or "1200"; code converts it. */
export const decimalAmount = () =>
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, "use digits with an optional decimal point, e.g. 49.99")
    .describe("Decimal amount as plain digits, e.g. 49.99 or 1200 (no currency symbol).");

export const FREELANCER_AGENTS = ["PROFILE", "TREASURY", "PROJECTS"] as const;

export const handoffTool = defineTool({
  name: "handoff",
  description:
    "Pass the conversation to another freelancer assistant when the request belongs to its area: PROFILE (services, service pages, translations, rates per market), TREASURY (balances, money in holding, fees, forecasts, payouts, invoices), PROJECTS (contracts, milestones, deliveries, disputes, refunds, earnings by client or market). Call it at most once, with a short summary of what the freelancer wants and any facts already established. It returns a confirmation; after calling it, tell the freelancer in one sentence who will take over. Never hand off to yourself, and never use it for requests you can handle.",
  kind: "read",
  input: z.object({
    agent: z.enum(FREELANCER_AGENTS).describe("The assistant that should take over."),
    summary: z.string().min(1).max(1500).describe("What the freelancer wants and what is already known, in English."),
  }),
  async run(ctx, input) {
    freelancerOf(ctx);
    if (input.agent === ctx.agent) throw new AppError("INVALID_INPUT", "You cannot hand off to yourself; handle this request directly.");
    return { handoff: { agent: input.agent, summary: input.summary }, message: `Handed off to the ${input.agent.toLowerCase()} assistant.` };
  },
});
