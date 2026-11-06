import { requireSeller } from "@/server/auth";
import { handler, json } from "@/server/http";
import { periodFrom } from "@/server/period-query";
import { sellerSalesRows } from "@/server/services/analytics";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  return json(await sellerSalesRows(seller.sellerId, periodFrom(req)));
});
