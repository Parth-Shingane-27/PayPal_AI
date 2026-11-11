import { z } from "zod";
import { PERIOD_PRESETS, resolvePeriod } from "./domain/period";

const periodQuery = z.object({ period: z.enum(PERIOD_PRESETS).default("last_90_days") });

/** Reads ?period= from a request URL; defaults to the last 90 days. */
export function periodFrom(req: Request) {
  const sp = new URL(req.url).searchParams;
  return resolvePeriod({ preset: periodQuery.parse({ period: sp.get("period") ?? undefined }).period });
}
