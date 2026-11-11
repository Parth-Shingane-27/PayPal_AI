import { gigOwnerOf, requireClient } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { briefInputSchema, closeBrief, getBrief, saveBrief } from "@/server/services/gig/briefs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  const c = await requireClient(req);
  return json(await getBrief(gigOwnerOf(c), await routeId(ctx.params, "Brief")));
});

export const PUT = handler(async (req, ctx: Ctx) => {
  const c = await requireClient(req);
  const id = await routeId(ctx.params, "Brief");
  return json(await saveBrief(gigOwnerOf(c), await readBody(req, briefInputSchema), id));
});

/** Closing a brief stops new quotes on it. */
export const DELETE = handler(async (req, ctx: Ctx) => {
  const c = await requireClient(req);
  return json(await closeBrief(gigOwnerOf(c), await routeId(ctx.params, "Brief")));
});
