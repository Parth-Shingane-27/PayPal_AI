import { gigOwnerOf, requireClient } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { publishBrief } from "@/server/services/gig/briefs";

type Ctx = { params: Promise<{ id: string }> };

/** Puts a draft project on the board. */
export const POST = handler(async (req, ctx: Ctx) => {
  const c = await requireClient(req);
  return json(await publishBrief(gigOwnerOf(c), await routeId(ctx.params, "Project")));
});
