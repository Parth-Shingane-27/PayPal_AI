import { requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { freelancerBalancesView } from "@/server/services/gig/ledger";

/** Available vs in holding, per currency. */
export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  return json(await freelancerBalancesView(f.freelancerId, f.locale));
});
