import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { milestoneStatus } from "@/server/services/gig/insights";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const p = await requirePrincipal(req);
  return json(await milestoneStatus(gigOwnerOf(p), await routeId(ctx.params, "Milestone")));
});
