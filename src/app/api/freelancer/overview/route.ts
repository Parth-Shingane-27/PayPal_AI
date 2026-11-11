import { requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { freelancerOverview } from "@/server/services/gig/dashboards";

export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  return json(await freelancerOverview(f.freelancerId));
});
