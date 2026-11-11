import { requireFreelancer } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { publishServicePage } from "@/server/services/gig/catalog";

/** The freelancer's click: publish a draft service page. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const f = await requireFreelancer(req);
  const page = await publishServicePage(f.freelancerId, await routeId(ctx.params, "Service page"));
  return json({ page_id: page.id, status: page.status });
});
