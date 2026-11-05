import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { refundNow } from "@/server/services/quick-actions";

/** The seller's Refund click: refunds through PayPal now (amount omitted = everything still refundable). */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const orderId = await routeId(ctx.params, "Order");
  const body = await readBody(
    req,
    z.object({ amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a number like 12.50").nullish(), reason: z.string().trim().min(1).max(500) }),
  );
  return json(await refundNow(seller.sellerId, { orderId, amount: body.amount ?? undefined, reason: body.reason }));
});
