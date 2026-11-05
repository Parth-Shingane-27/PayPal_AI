import { requireSeller } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { getProduct } from "@/server/services/catalog";
import { money } from "@/server/domain/money";

/** Product editor data: the product and its per-market listings (drafts included). */
export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const p = await getProduct(seller.sellerId, await routeId(ctx.params, "Product"));
  return json({
    product: {
      id: p.id,
      sku: p.sku,
      title: p.title,
      description: p.description,
      source_locale: p.source_locale,
      cost: money(p.cost_minor, p.cost_currency, seller.locale),
      shipping: money(p.shipping_minor, p.cost_currency, seller.locale),
      margin_percent: p.margin_bps / 100,
      attributes: p.attributes,
    },
    listings: p.listings.map((l) => ({
      id: l.id,
      locale: l.locale,
      status: l.status,
      title: l.title,
      description: l.description,
      seo_title: l.seo_title,
      price: money(l.price_minor, l.currency, l.locale),
      pricing: l.pricing,
      embedded: l.embedded_at !== null,
      updated_at: l.updated_at,
    })),
  });
});
