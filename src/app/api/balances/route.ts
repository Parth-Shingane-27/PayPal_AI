import { requireSeller } from "@/server/auth";
import { handler, json } from "@/server/http";
import { balancesView } from "@/server/services/ledger";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  return json(await balancesView(seller.sellerId, seller.locale));
});
