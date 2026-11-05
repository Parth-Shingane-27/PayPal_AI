import { requireSeller } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { publishListing } from "@/server/services/catalog";

/** The seller's Publish click: the approval for a listing. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const listing = await publishListing(seller.sellerId, await routeId(ctx.params, "Listing"));
  return json({ id: listing.id, status: listing.status });
});
