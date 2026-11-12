import { gigOwnerOf, requireFreelancer } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { getOpenBrief } from "@/server/services/gig/briefs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  const f = await requireFreelancer(req);
  return json(await getOpenBrief(gigOwnerOf(f), await routeId(ctx.params, "Project")));
});
