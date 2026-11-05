import { requireSeller } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { orderDetails, paymentStatus } from "@/server/services/insights";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const id = await routeId(ctx.params, "Order");
  const [details, payment] = await Promise.all([orderDetails(seller.sellerId, id, seller.locale), paymentStatus(seller.sellerId, id, seller.locale)]);
  return json({ ...details, payment_status: payment });
});
