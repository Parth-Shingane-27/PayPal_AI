import { requireSeller } from "@/server/auth";
import { handler, json } from "@/server/http";
import { periodFrom } from "@/server/period-query";
import { sellerOverview } from "@/server/services/analytics";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  return json(await sellerOverview(seller.sellerId, periodFrom(req)));
});
