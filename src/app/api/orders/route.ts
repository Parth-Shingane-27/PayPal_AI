import { requirePrincipal } from "@/server/auth";
import { handler, json } from "@/server/http";
import { buyerOrders, queryOrders } from "@/server/services/insights";

/** Sellers see their orders; buyers see their own purchases. */
export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  if (p.role === "BUYER") return json({ orders: await buyerOrders(p.buyerId) });
  return json(await queryOrders(p.sellerId, { limit: 50 }));
});
