import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { MARKET_LOCALES } from "@/server/domain/markets";
import { handler, json, readBody, routeId } from "@/server/http";
import { localizeProduct } from "@/server/services/localize";

/** "Create listings": prices by code, text by AI, saved as drafts for the seller to publish. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const seller = await requireSeller(req);
  const productId = await routeId(ctx.params, "Product");
  const body = await readBody(
    req,
    z.object({
      markets: z.array(z.enum(MARKET_LOCALES)).min(1).max(MARKET_LOCALES.length),
      positioning: z.enum(["competitive", "market", "premium"]).nullish(),
    }),
  );
  return json(await localizeProduct(seller.sellerId, productId, body.markets, undefined, { positioning: body.positioning ?? undefined }));
});
