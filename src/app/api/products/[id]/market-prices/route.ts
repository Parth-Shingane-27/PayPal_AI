import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { MARKET_LOCALES } from "@/server/domain/markets";
import { handler, json, readBody, routeId } from "@/server/http";
import { researchMarketPrices, savedMarketResearch } from "@/server/services/market-research";
import { quotePrice } from "@/server/services/pricing";
import { AppError } from "@/server/errors";

/** What the price would be at each positioning, given the stored research (code, no AI). */
async function suggestions(sellerId: string, productId: string, market: string) {
  const out: Record<string, unknown> = {};
  for (const positioning of ["competitive", "market", "premium"] as const) {
    try {
      const q = await quotePrice(sellerId, { productId, locale: market, positioning });
      out[positioning] = { price: q.suggested_price, profit: q.profit, margin_percent: q.margin_percent, strategy: q.strategy, warnings: q.warnings };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      out[positioning] = { error: err.message };
    }
  }
  const floor = await quotePrice(sellerId, { productId, locale: market });
  return { margin_floor_price: floor.margin_floor_price, cost_based_price: floor.suggested_price, by_positioning: out };
}

/** Saved research per market, each with price suggestions. */
export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const productId = await routeId(ctx.params, "Product");
  const saved = await savedMarketResearch(seller.sellerId, productId);
  const markets = await Promise.all(
    saved.map(async (r) => ({ ...r, pricing: await suggestions(seller.sellerId, productId, r.market).catch(() => null) })),
  );
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
