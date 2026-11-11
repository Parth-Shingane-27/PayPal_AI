import { gigOwnerOf, requireFreelancer, requirePrincipal } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { closeQuote, sendQuote, sendQuoteSchema, viewQuote } from "@/server/services/gig/quotes";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  const p = await requirePrincipal(req);
  return json(await viewQuote(gigOwnerOf(p), await routeId(ctx.params, "Quote")));
});

/** The freelancer sends (or revises) the price. */
export const PUT = handler(async (req, ctx: Ctx) => {
  const f = await requireFreelancer(req);
  const id = await routeId(ctx.params, "Quote");
  return json(await sendQuote(gigOwnerOf(f), id, await readBody(req, sendQuoteSchema)));
});

/** Freelancer declines, or client withdraws / turns the price down. */
export const DELETE = handler(async (req, ctx: Ctx) => {
  const p = await requirePrincipal(req);
  return json(await closeQuote(gigOwnerOf(p), await routeId(ctx.params, "Quote")));
});
