import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { MARKET_LOCALES } from "@/server/domain/markets";
import { parseDecimal, parsePercentToBps, SUPPORTED_CURRENCIES } from "@/server/domain/money";
import { handler, json, readBody } from "@/server/http";
import { researchDraftPrices } from "@/server/services/market-research";

/**
 * Market prices while adding a product (it does not exist yet): what
 * comparable products sell for, what the typed cost and margin would charge,
 * and the margin at market prices. Research carries over when the product is created.
 */
export const POST = handler(async (req) => {
  const seller = await requireSeller(req);
  const body = await readBody(
    req,
    z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().min(1).max(5000),
      cost: z.string(),
      shipping: z.string().nullish(),
      cost_currency: z.enum(SUPPORTED_CURRENCIES),
      margin_percent: z.string().nullish(),
      attributes: z.record(z.string(), z.unknown()).nullish(),
      markets: z.array(z.enum(MARKET_LOCALES)).min(1).max(4),
      refresh: z.boolean().nullish(),
    }),
  );
  const markets = await researchDraftPrices(
    seller.sellerId,
    {
      title: body.title,
      description: body.description,
      attributes: body.attributes ?? {},
      cost_minor: parseDecimal(body.cost, body.cost_currency),
      shipping_minor: parseDecimal(body.shipping || "0", body.cost_currency),
      cost_currency: body.cost_currency,
      margin_bps: parsePercentToBps(body.margin_percent || "30"),
    },
    body.markets,
    { refresh: body.refresh ?? false },
  );
  return json({ markets });
});
