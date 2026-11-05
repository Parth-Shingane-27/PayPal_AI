import { z } from "zod";
import { requireBuyer } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { addToCart, MAX_QUANTITY, updateCart, viewCart } from "@/server/services/cart";

export const GET = handler(async (req) => {
  const buyer = await requireBuyer(req);
  return json(await viewCart(buyer.buyerId));
});

/** "Add to cart" from the shop's product list. Only listings in the buyer's market can be added. */
export const POST = handler(async (req) => {
  const buyer = await requireBuyer(req);
  const body = await readBody(req, z.object({ listing_id: z.uuid(), quantity: z.number().int().min(1).max(MAX_QUANTITY) }));
  return json(await addToCart(buyer.buyerId, buyer.market, body.listing_id, body.quantity));
});

/** Quantity edits from the cart page; 0 removes the item. */
export const PATCH = handler(async (req) => {
  const buyer = await requireBuyer(req);
  const body = await readBody(req, z.object({ listing_id: z.uuid(), quantity: z.number().int().min(0).max(MAX_QUANTITY) }));
  return json(await updateCart(buyer.buyerId, body.listing_id, body.quantity));
});
