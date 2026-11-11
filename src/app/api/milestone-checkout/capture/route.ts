import { z } from "zod";
import { gigOwnerOf, requireClient } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { authorizeMilestoneFunding } from "@/server/services/gig/milestone-payments";

/**
 * PayPal onApprove / return page: places the hold on the milestone payment
 * (authorized, not charged). The capture happens at release. Idempotent.
 */
export const POST = handler(async (req) => {
  const c = await requireClient(req);
  const { paypal_order_id } = await readBody(req, z.object({ paypal_order_id: z.string().min(1).max(64) }));
  return json(await authorizeMilestoneFunding(gigOwnerOf(c), paypal_order_id, { actor: { type: "CLIENT", clientId: c.clientId } }));
});
