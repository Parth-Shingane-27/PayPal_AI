import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { getInvoice } from "@/server/services/gig/invoices";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const p = await requirePrincipal(req);
  return json(await getInvoice(gigOwnerOf(p), await routeId(ctx.params, "Invoice")));
});
