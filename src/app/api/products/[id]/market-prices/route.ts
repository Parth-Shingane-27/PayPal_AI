import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { prisma } from "@/server/db";
import { MARKET_LOCALES } from "@/server/domain/markets";
import { notFound } from "@/server/errors";
import { handler, json, readBody, routeId } from "@/server/http";
import { pricingAtPositions, researchMarketPrices, savedMarketResearch } from "@/server/services/market-research";
import { latestResearch } from "@/server/services/pricing";

/** What the price would be at each positioning, and the margin at market prices (code, no AI). */
async function suggestions(sellerId: string, productId: string, market: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, seller_id: sellerId } });
  if (!product) throw notFound("Product");
  return pricingAtPositions(sellerId, product, market, await latestResearch(sellerId, productId, market));
}

/** Saved research per market, each with price suggestions. */
export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const productId = await routeId(ctx.params, "Product");
  const saved = await savedMarketResearch(seller.sellerId, productId);
  const markets = await Promise.all(saved.map(async (r) => ({ ...r, pricing: await suggestions(seller.sellerId, productId, r.market).catch(() => null) })));
  return json({ markets });
});

/** "Check market prices": web + GlobalCart research for the chosen markets. Reuses research from the last day unless refresh is set. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const productId = await routeId(ctx.params, "Product");
  const body = await readBody(req, z.object({ markets: z.array(z.enum(MARKET_LOCALES)).min(1).max(MARKET_LOCALES.length), refresh: z.boolean().nullish() }));
  const results = await researchMarketPrices(seller.sellerId, productId, body.markets, { refresh: body.refresh ?? false });
  const markets = await Promise.all(
    results.map(async (r) => ("error" in r ? r : { ...r, pricing: await suggestions(seller.sellerId, productId, r.market).catch(() => null) })),
  );
  return json({ markets });
});
