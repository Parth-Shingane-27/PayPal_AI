import { z } from "zod";
import { AppError } from "../errors";
import { fetchWithRetry, type RetryOptions } from "./http";

/**
 * Frankfurter (ECB reference rates): GET /v1/latest?base=XXX returns
 * { amount, base, date, rates }. Rates are cached per base for 10 minutes.
 */

const BASE_URL = "https://api.frankfurter.dev/v1";
const TTL_MS = 10 * 60 * 1000;

const latestSchema = z.object({
  base: z.string(),
  date: z.string(),
  rates: z.record(z.string(), z.number().positive()),
});

type FxRate = { from: string; to: string; rate: number; date: string; source: "ECB via Frankfurter" };

type Deps = RetryOptions & { now?: () => number };

export class FrankfurterClient {
  private readonly cache = new Map<string, { at: number; date: string; rates: Record<string, number> }>();
  private readonly now: () => number;

  constructor(private readonly deps: Deps = {}) {
    this.now = deps.now ?? Date.now;
  }

  private async latest(base: string) {
    const hit = this.cache.get(base);
    if (hit && this.now() - hit.at < TTL_MS) return hit;
    let res: Response;
    try {
      res = await fetchWithRetry(`${BASE_URL}/latest?base=${encodeURIComponent(base)}`, { method: "GET" }, this.deps);
    } catch {
      throw new AppError("UPSTREAM_ERROR", "The exchange-rate service is unreachable right now.");
    }
    if (!res.ok) throw new AppError("UPSTREAM_ERROR", `The exchange-rate service returned HTTP ${res.status} for ${base}.`);
    const body = latestSchema.parse(await res.json());
    const entry = { at: this.now(), date: body.date, rates: body.rates };
    this.cache.set(base, entry);
    return entry;
  }

  /** 1 `from` = rate `to`. Same-currency conversions return rate 1. */
  async getRate(from: string, to: string): Promise<FxRate> {
    if (from === to) return { from, to, rate: 1, date: new Date(this.now()).toISOString().slice(0, 10), source: "ECB via Frankfurter" };
    const { date, rates } = await this.latest(from);
    const rate = rates[to];
    if (rate === undefined) throw new AppError("INVALID_INPUT", `No exchange rate from ${from} to ${to}.`);
    return { from, to, rate, date, source: "ECB via Frankfurter" };
  }
}

export const frankfurter = new FrankfurterClient();

export type FxApi = Pick<FrankfurterClient, "getRate">;
