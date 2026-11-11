import { requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { periodFrom } from "@/server/period-query";
import { freelancerLedgerGrid } from "@/server/services/gig/dashboards";

/** The earnings ledger: Milestones, Clients, Services and Markets tabs. ?period= or ?from=&to= */
export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  const period = periodFrom(req);
  return json({ period: { label: period.label }, ...(await freelancerLedgerGrid(f.freelancerId, period, f.locale)) });
});
