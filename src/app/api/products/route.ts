import { requireSeller } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { createProduct, listProducts, productFormSchema, productFromForm } from "@/server/services/catalog";
import { money } from "@/server/domain/money";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  const products = await listProducts(seller.sellerId);
  return json({
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      title: p.title,
      cost: money(p.cost_minor + p.shipping_minor, p.cost_currency, seller.locale),
      listings: p.listings.map((l) => ({ id: l.id, locale: l.locale, status: l.status, price: money(l.price_minor, l.currency, l.locale) })),
    })),
  });
});

export const POST = handler(async (req) => {
  const seller = await requireSeller(req);
  const product = await createProduct(seller.sellerId, productFromForm(await readBody(req, productFormSchema)));
  return json({ id: product.id }, 201);
});
