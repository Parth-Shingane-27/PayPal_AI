import Groq from "groq-sdk";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { frankfurter } from "@/server/clients/frankfurter";
import { prisma } from "@/server/db";
import { closeQueues } from "@/server/queue";
import { addToCart } from "@/server/services/cart";
import { localizeProduct } from "@/server/services/localize";
import { quotePrice } from "@/server/services/pricing";
import { payOutNow, refundNow } from "@/server/services/quick-actions";
import { listPublishedListings } from "@/server/services/search";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb } from "../helpers/db";
import { fakePayPal } from "../helpers/fakes";
import { reply, scriptedModel, text } from "../helpers/fake-model";

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("GROQ_API_KEY", "test");
  vi.stubEnv("GROQ_AGENT_MODEL", "openai/gpt-oss-120b");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(closeQueues);

async function world() {
  const seller = await makeSeller();
  const buyer = await makeBuyer();
  const product = await makeProduct(seller.id);
  const listing = await makeListing(seller.id, product.id, { price_minor: 10000 });
  return { seller, buyer, product, listing };
}

describe("refund now", () => {
  it("refunds everything still refundable in one click, recorded as done by a person", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const pp = fakePayPal({ refundCapture: async () => ({ refundId: "R-1", status: "COMPLETED", paypalFeeReturnedMinor: 0 }) });
    const d = await refundNow(w.seller.id, { orderId: order.id, reason: "Arrived damaged" }, { paypal: pp.api });
    expect(d).toMatchObject({ status: "EXECUTED", already_decided: false });
    expect(await prisma.refund.findFirstOrThrow()).toMatchObject({ amount_minor: 10000, status: "COMPLETED", reason: "Arrived damaged" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");
    const row = await prisma.agentAction.findFirstOrThrow({ where: { tool: "propose_refund" } });
    expect(row).toMatchObject({ agent: null, status: "EXECUTED", decided_by: w.seller.id });

    // A second click finds nothing left and never reaches PayPal.
    await expect(refundNow(w.seller.id, { orderId: order.id, reason: "again" }, { paypal: pp.api })).rejects.toMatchObject({ code: "NOT_REFUNDABLE" });
    expect(pp.count("refundCapture")).toBe(1);
  });

  it("refunds a partial amount and rejects more than is left", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const pp = fakePayPal({ refundCapture: async () => ({ refundId: "R-2", status: "COMPLETED", paypalFeeReturnedMinor: 0 }) });
    await refundNow(w.seller.id, { orderId: order.id, amount: "30.00", reason: "Partial" }, { paypal: pp.api });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PARTIALLY_REFUNDED");
    await expect(refundNow(w.seller.id, { orderId: order.id, amount: "80.00", reason: "Too much" }, { paypal: pp.api })).rejects.toMatchObject({
      code: "NOT_REFUNDABLE",
    });
  });

  it("treats another seller's order as not found", async () => {
    const w = await world();
    const mallory = await makeSeller();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    await expect(refundNow(mallory.id, { orderId: order.id, reason: "x" }, { paypal: fakePayPal().api })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.refund.count()).toBe(0);
  });
});

describe("pay out now", () => {
  it("schedules everything available for today, and a second click finds nothing left", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const now = new Date();
    const d = await payOutNow(w.seller.id, "USD", now);
    expect(d).toMatchObject({ status: "EXECUTED", already_decided: false });
    const payout = await prisma.payout.findFirstOrThrow();
    expect(payout.status).toBe("SCHEDULED");
    expect(payout.amount_minor).toBeGreaterThan(0);
    await expect(payOutNow(w.seller.id, "USD", now)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("refuses when there is no balance", async () => {
    const seller = await makeSeller();
    await expect(payOutNow(seller.id, "USD")).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await prisma.payout.count()).toBe(0);
  });
});

describe("create listings (one click)", () => {
  const rates: Record<string, number> = { "USD->EUR": 0.9, "USD->JPY": 150, "USD->USD": 1 };
  const stubFx = () =>
    vi.spyOn(frankfurter, "getRate").mockImplementation(async (from, to) => ({ from, to, rate: rates[`${from}->${to}`]!, date: "2026-11-04", source: "ECB via Frankfurter" }));

  it("saves drafts at exactly the calculated prices with the AI's text", async () => {
    stubFx();
    const w = await world();
    const long = "ウォールナット".repeat(20); // 140 characters: longer than the SEO limit
    const s = scriptedModel([
      reply([
        text(
          JSON.stringify({
            listings: [
              { market: "de-DE", title: "Walnuss-Servierbrett", seo_title: "Walnuss-Servierbrett handgeschnitzt", description: "Aus Walnussholz." },
              { market: "ja-JP", title: "ウォールナットのサービングボード", seo_title: long, description: "ウォールナット材。" },
            ],
          }),
        ),
      ]),
    ]);
    const res = await localizeProduct(w.seller.id, w.product.id, ["de-DE", "ja-JP"], s.model);
    expect(res.failed).toEqual([]);
    expect(res.saved.map((x) => x.market)).toEqual(["de-DE", "ja-JP"]);

    for (const locale of ["de-DE", "ja-JP"]) {
      const quote = await quotePrice(w.seller.id, { productId: w.product.id, locale });
      const listing = await prisma.listing.findFirstOrThrow({ where: { product_id: w.product.id, locale } });
      expect(listing).toMatchObject({ status: "DRAFT", price_minor: quote.suggested_price.amount_minor });
    }
    const ja = await prisma.listing.findFirstOrThrow({ where: { product_id: w.product.id, locale: "ja-JP" } });
    expect([...ja.seo_title]).toHaveLength(70);

    // One structured-output call: the strict JSON schema, and no prices or ids for the model to write.
    const req = s.requests[0]!;
    expect(req.model).toBe("openai/gpt-oss-120b");
    expect(req.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "listing_copy", strict: true } });
    expect(JSON.stringify(req.response_format)).not.toMatch(/price|seller_id/);
    expect((await prisma.agentAction.findFirstOrThrow({ where: { tool: "model.localize" } })).status).toBe("SUCCEEDED");
  });

  it("reports a market the AI skipped instead of saving an empty listing", async () => {
    stubFx();
    const w = await world();
    const s = scriptedModel([reply([text(JSON.stringify({ listings: [{ market: "de-DE", title: "Brett", seo_title: "Brett", description: "Holz." }] }))])]);
    const res = await localizeProduct(w.seller.id, w.product.id, ["de-DE", "ja-JP"], s.model);
    expect(res.saved.map((x) => x.market)).toEqual(["de-DE"]);
    expect(res.failed).toEqual([{ market: "ja-JP", error: expect.stringContaining("did not write text") }]);
    expect(await prisma.listing.count({ where: { product_id: w.product.id, locale: "ja-JP" } })).toBe(0);
  });

  it("turns a Groq rate limit into a readable error and saves nothing", async () => {
    stubFx();
    const w = await world();
    const s = scriptedModel([new Groq.RateLimitError(429, { error: { message: "rate limit" } }, "rate limit", new Headers())]);
    await expect(localizeProduct(w.seller.id, w.product.id, ["de-DE"], s.model)).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: expect.stringMatching(/busy/) });
    expect(await prisma.listing.count({ where: { product_id: w.product.id, locale: "de-DE" } })).toBe(0);
    expect((await prisma.agentAction.findFirstOrThrow({ where: { tool: "model.localize" } })).status).toBe("FAILED");
  });

  it("rejects another seller's product", async () => {
    const w = await world();
    const mallory = await makeSeller();
    await expect(localizeProduct(mallory.id, w.product.id, ["de-DE"], scriptedModel([]).model)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("shop list", () => {
  it("shows every published listing in the buyer's market, indexed for search or not", async () => {
    const w = await world();
    await makeListing(w.seller.id, (await makeProduct(w.seller.id)).id, { title: "Draft thing", status: "DRAFT" });
    await makeListing(w.seller.id, (await makeProduct(w.seller.id)).id, { title: "German thing", locale: "de-DE" });
    const list = await listPublishedListings("en-US");
    expect(list.map((l) => l.title)).toEqual([w.listing.title]);
    expect(list[0]!.price.display).toBe("$100.00");
  });

  it("adds a listed item to the cart, but not one from another market", async () => {
    const w = await world();
    const de = await makeListing(w.seller.id, (await makeProduct(w.seller.id)).id, { locale: "de-DE" });
    const cart = await addToCart(w.buyer.id, "en-US", w.listing.id, 1);
    expect(cart.carts[0]!.items.map((i) => i.listing_id)).toEqual([w.listing.id]);
    await expect(addToCart(w.buyer.id, "en-US", de.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
