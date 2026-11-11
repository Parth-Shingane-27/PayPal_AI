import { requireFreelancer } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { unpublishServicePage } from "@/server/services/gig/catalog";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const f = await requireFreelancer(req);
  return json(await unpublishServicePage(f.freelancerId, await routeId(ctx.params, "Service page")));
});
