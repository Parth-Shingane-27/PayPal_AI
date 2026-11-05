import { describe, expect, it, vi } from "vitest";
import { FrankfurterClient } from "@/server/clients/frankfurter";
import { VoyageClient } from "@/server/clients/voyage";
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

describe("Voyage", () => {
  const vec = (x: number) => Array.from({ length: 1024 }, () => x);

  it("sends voyage-4 at 1024 dimensions and orders results by index", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ input: ["a", "b"], model: "voyage-4", input_type: "query", output_dimension: 1024 });
      return json(200, { data: [{ embedding: vec(2), index: 1 }, { embedding: vec(1), index: 0 }] });
    });
    const v = new VoyageClient({ fetch: fetch as unknown as typeof globalThis.fetch, apiKey: () => "k" });
    const out = await v.embed(["a", "b"], "query");
    expect(out[0]![0]).toBe(1);
    expect(out[1]![0]).toBe(2);
  });

  it("rejects wrong dimensions and missing items", async () => {
    const short = vi.fn(async () => json(200, { data: [{ embedding: [1, 2], index: 0 }] }));
    await expect(new VoyageClient({ fetch: short as unknown as typeof globalThis.fetch, apiKey: () => "k" }).embed(["a"], "document")).rejects.toThrow(/dimensions/);
    const missing = vi.fn(async () => json(200, { data: [{ embedding: vec(1), index: 0 }] }));
    await expect(new VoyageClient({ fetch: missing as unknown as typeof globalThis.fetch, apiKey: () => "k" }).embed(["a", "b"], "document")).rejects.toThrow(/missing/);
  });

  it("maps a persistent 429 to RATE_LIMITED", async () => {
    const fetch = vi.fn(async () => json(429, { detail: "slow down" }));
    const v = new VoyageClient({ fetch: fetch as unknown as typeof globalThis.fetch, apiKey: () => "k", sleep: async () => {} });
    await expect(v.embed(["a"], "query")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
