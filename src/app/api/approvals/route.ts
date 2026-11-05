import { requireSeller } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listApprovals } from "@/server/services/approvals";
import { approvalView } from "@/server/views";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  return json({ approvals: (await listApprovals(seller.sellerId)).map((a) => approvalView(a, seller.locale)) });
});
