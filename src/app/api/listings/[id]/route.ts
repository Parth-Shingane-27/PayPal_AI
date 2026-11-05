import { requireSeller } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { editListing, listingEditSchema } from "@/server/services/catalog";

/** Hand edit in the listing editor; a published listing goes back to DRAFT. */
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const listing = await editListing(seller.sellerId, await routeId(ctx.params, "Listing"), await readBody(req, listingEditSchema));
  return json({ id: listing.id, status: listing.status });
});
