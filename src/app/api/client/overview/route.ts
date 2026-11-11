import { requireClient } from "@/server/auth";
import { handler, json } from "@/server/http";
import { clientOverview } from "@/server/services/gig/dashboards";

export const GET = handler(async (req) => {
  const c = await requireClient(req);
  return json(await clientOverview(c.clientId, c.market));
});
