import { requireSeller } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { approveAction } from "@/server/services/approvals";

/** The seller's approval click. Reachable only through this route, never from a tool. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  return json(await approveAction(await routeId(ctx.params, "Approval"), seller.sellerId));
});
