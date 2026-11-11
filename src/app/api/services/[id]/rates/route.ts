import { z } from "zod";
import { requireFreelancer } from "@/server/auth";
import { MARKET_LOCALES } from "@/server/domain/markets";
import { handler, json, readBody, routeId } from "@/server/http";
import { researchServiceRates, subjectOf } from "@/server/services/gig/market-rates";
import { suggestRate } from "@/server/services/gig/rates";

const body = z.object({
  markets: z.array(z.enum(MARKET_LOCALES)).min(1).max(6),
  refresh: z.boolean().default(false),
  positioning: z.enum(["competitive", "market", "premium"]).nullable().default(null),
});

/** Market rate research for a service, plus a suggested price per market at the chosen positioning. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const f = await requireFreelancer(req);
  const id = await routeId(ctx.params, "Service");
  const b = await readBody(req, body);
  const research = await researchServiceRates(f.freelancerId, await subjectOf(f.freelancerId, id), b.markets, { refresh: b.refresh });
  const quotes = await Promise.all(b.markets.map((m) => suggestRate(f.freelancerId, { serviceId: id, locale: m, positioning: b.positioning ?? undefined }).catch((e: unknown) => ({ market: m, error: e instanceof Error ? e.message : "failed" }))));
  return json({ research, quotes });
});
