import { z } from "zod";
import { requireBuyer } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { startCheckout } from "@/server/services/checkout";

/** PayPal Buttons createOrder: creates (or reuses) the PayPal order for one cart. */
export const POST = handler(async (req) => {
  const buyer = await requireBuyer(req);
  const { cart_id } = await readBody(req, z.object({ cart_id: z.uuid() }));
  return json(await startCheckout(buyer.buyerId, cart_id, { actor: { type: "BUYER", buyerId: buyer.buyerId } }));
});
