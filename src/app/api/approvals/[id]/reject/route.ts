import { requireSeller } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { rejectAction } from "@/server/services/approvals";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  return json(await rejectAction(await routeId(ctx.params, "Approval"), seller.sellerId));
});
