import { gigOwnerOf, requireClient } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { startMilestoneFunding } from "@/server/services/gig/milestone-payments";

/** The client's "Fund next milestone" click: creates (or reuses) the PayPal order. Charges nothing until they approve in PayPal. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const c = await requireClient(req);
  const id = await routeId(ctx.params, "Contract");
  return json(await startMilestoneFunding(gigOwnerOf(c), id, { actor: { type: "CLIENT", clientId: c.clientId } }));
});
