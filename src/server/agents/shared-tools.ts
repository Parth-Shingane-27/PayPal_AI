import { z } from "zod";
import { AppError } from "../errors";
import type { GigOwner } from "../services/gig/owner";
import type { ToolCtx } from "./tool";

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
