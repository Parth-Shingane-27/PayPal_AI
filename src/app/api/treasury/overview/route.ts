import { requireSeller } from "@/server/auth";
import { handler, json } from "@/server/http";
import { treasuryOverview } from "@/server/services/treasury";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  return json(await treasuryOverview(seller.sellerId, seller.locale));
});
