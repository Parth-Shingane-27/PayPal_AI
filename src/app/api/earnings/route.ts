import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { MARKET_LOCALES } from "@/server/domain/markets";
import { handler, json } from "@/server/http";
import { earningsByMarket, PERIOD_PRESETS, resolvePeriod } from "@/server/services/ledger";

const query = z.object({ period: z.enum(PERIOD_PRESETS).default("last_30_days"), market: z.enum(MARKET_LOCALES).optional() });

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  const sp = new URL(req.url).searchParams;
  const q = query.parse({ period: sp.get("period") ?? undefined, market: sp.get("market") ?? undefined });
  return json(await earningsByMarket(seller.sellerId, resolvePeriod({ preset: q.period }), seller.locale, q.market));
});
