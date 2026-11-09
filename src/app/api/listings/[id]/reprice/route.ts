import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { handler, json, readBody, routeId } from "@/server/http";
import { setListingPrice } from "@/server/services/catalog";
import { quotePrice } from "@/server/services/pricing";

/** "Use this price": re-quotes the listing's market at a positioning (code only) and saves the price as a draft, keeping the text. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const listingId = await routeId(ctx.params, "Listing");
  const body = await readBody(req, z.object({ positioning: z.enum(["competitive", "market", "premium"]) }));
  const listing = await prisma.listing.findFirst({ where: { id: listingId, seller_id: seller.sellerId } });
  if (!listing) throw notFound("Listing");
  const quote = await quotePrice(seller.sellerId, { productId: listing.product_id, locale: listing.locale, positioning: body.positioning });
  const { listing: saved } = await setListingPrice(seller.sellerId, listing.product_id, listing.locale, quote.suggested_price.amount_minor, quote);
  return json({ id: saved.id, status: saved.status, price: quote.suggested_price, warnings: quote.warnings });
});
