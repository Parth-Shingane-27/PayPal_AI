import { requireSeller } from "@/server/auth";
import { handler, json } from "@/server/http";
import { periodFrom } from "@/server/period-query";
import { sellerProductRows } from "@/server/services/analytics";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  return json(await sellerProductRows(seller.sellerId, periodFrom(req)));
});
