import { z } from "zod";
import { gigOwnerOf, requireClient } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { captureMilestoneFunding } from "@/server/services/gig/milestone-payments";

/** PayPal onApprove / return page: captures the milestone payment into holding. Idempotent. */
export const POST = handler(async (req) => {
  const c = await requireClient(req);
  const { paypal_order_id } = await readBody(req, z.object({ paypal_order_id: z.string().min(1).max(64) }));
  return json(await captureMilestoneFunding(gigOwnerOf(c), paypal_order_id, { actor: { type: "CLIENT", clientId: c.clientId } }));
});
