import { requireSeller } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { unpublishListing } from "@/server/services/catalog";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const listing = await unpublishListing(seller.sellerId, await routeId(ctx.params, "Listing"));
  return json({ id: listing.id, status: listing.status });
});
