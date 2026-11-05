import { z } from "zod";
import { AppError } from "../../errors";
import { defineTool, type ToolCtx } from "../tool";

/** The seller id from the session; seller tools never take it as input. */
export function sellerOf(ctx: ToolCtx): string {
  if (ctx.actor.type !== "SELLER") throw new AppError("FORBIDDEN", "This tool is only available to sellers.");
  return ctx.actor.sellerId;
}

export function buyerOf(ctx: ToolCtx): string {
  if (ctx.actor.type !== "BUYER") throw new AppError("FORBIDDEN", "This tool is only available to buyers.");
  return ctx.actor.buyerId;
}

export const uuid = () => z.uuid();

/** Decimal money as the user wrote it, e.g. "49.99" or "1200"; code converts it. */
export const decimalAmount = () =>
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, "use digits with an optional decimal point, e.g. 49.99")
    .describe("Decimal amount as plain digits, e.g. 49.99 or 1200 (no currency symbol).");

const SELLER_AGENTS = ["LISTING", "TREASURY", "OPERATIONS"] as const;

export const handoffTool = defineTool({
  name: "handoff",
  description:
    "Pass the conversation to another seller assistant when the request belongs to its area: LISTING (products, translations, listing prices), TREASURY (balances, fees, forecasts, payouts), OPERATIONS (orders, refunds, earnings by market, anomalies). Call it at most once, with a short summary of what the seller wants and any facts already established. It returns a confirmation; after calling it, tell the seller in one sentence who will take over. Never hand off to yourself, and never use it for requests you can handle.",
  kind: "read",
  input: z.object({
    agent: z.enum(SELLER_AGENTS).describe("The assistant that should take over."),
    summary: z.string().min(1).max(1500).describe("What the seller wants and what is already known, in English."),
  }),
  async run(ctx, input) {
    sellerOf(ctx);
    if (input.agent === ctx.agent) throw new AppError("INVALID_INPUT", "You cannot hand off to yourself; handle this request directly.");
    return { handoff: { agent: input.agent, summary: input.summary }, message: `Handed off to the ${input.agent.toLowerCase()} assistant.` };
  },
});
