import { requireBuyer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { buyerPurchaseRows } from "@/server/services/analytics";

export const GET = handler(async (req) => {
  const buyer = await requireBuyer(req);
  return json(await buyerPurchaseRows(buyer.buyerId, buyer.market));
});
