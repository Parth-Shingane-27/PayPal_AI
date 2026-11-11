import { requireFreelancer } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { serviceView } from "@/server/services/gig/catalog";
import { serviceMarketOverview } from "@/server/services/gig/market-rates";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const f = await requireFreelancer(req);
  const id = await routeId(ctx.params, "Service");
  const [service, overview] = await Promise.all([serviceView(f.freelancerId, id), serviceMarketOverview(f.freelancerId, id)]);
  return json({ ...service, overview });
});
