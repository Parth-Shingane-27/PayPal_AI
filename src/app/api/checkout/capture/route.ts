import { z } from "zod";
import { requireBuyer } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { captureCheckout } from "@/server/services/checkout";

/** PayPal Buttons onApprove: captures after the buyer approved in PayPal. Idempotent. */
export const POST = handler(async (req) => {
  const buyer = await requireBuyer(req);
  const { paypal_order_id } = await readBody(req, z.object({ paypal_order_id: z.string().min(1).max(64) }));
  return json(await captureCheckout(buyer.buyerId, paypal_order_id, { actor: { type: "BUYER", buyerId: buyer.buyerId } }));
});
