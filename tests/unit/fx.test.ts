import { describe, expect, it, vi } from "vitest";
import { FrankfurterClient } from "@/server/clients/frankfurter";
import { AppError } from "@/server/errors";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("Frankfurter", () => {
  it("caches rates per base for 10 minutes", async () => {
    let now = 0;
    const fetch = vi.fn(async () => json(200, { amount: 1, base: "USD", date: "2026-11-04", rates: { EUR: 0.9, JPY: 150 } }));
    const fx = new FrankfurterClient({ fetch: fetch as unknown as typeof globalThis.fetch, now: () => now, sleep: async () => {} });
    expect(await fx.getRate("USD", "EUR")).toMatchObject({ rate: 0.9, date: "2026-11-04" });
    await fx.getRate("USD", "JPY");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0])).toContain("/v1/latest?base=USD");
    now = 10 * 60 * 1000;
    await fx.getRate("USD", "EUR");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns 1 for the same currency without a request", async () => {
    const fetch = vi.fn();
    const fx = new FrankfurterClient({ fetch: fetch as unknown as typeof globalThis.fetch });
    expect((await fx.getRate("EUR", "EUR")).rate).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries a 503 and reports a persistent failure as an AppError", async () => {
    const fetch = vi.fn(async () => json(503, {}));
    const fx = new FrankfurterClient({ fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} });
    await expect(fx.getRate("USD", "EUR")).rejects.toBeInstanceOf(AppError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
