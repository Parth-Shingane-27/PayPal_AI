import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayPalClient } from "@/server/clients/paypal";
import { prisma } from "@/server/db";
import { recordPayPalCall } from "@/server/services/audit";
import { editListing, productView, saveListingDraft } from "@/server/services/catalog";
import { compareSellingDirect, detectAnomalies, forecastEarnings, orderDetails, paymentStatus } from "@/server/services/insights";
import { earningsByMarket, resolvePeriod } from "@/server/services/ledger";
import { quotePrice } from "@/server/services/pricing";
import { embedListing, searchListings } from "@/server/services/search";
import { processWebhookEvent, storeWebhookEvent } from "@/server/services/webhooks";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb } from "../helpers/db";
import { fakeFx } from "../helpers/fakes";

beforeEach(resetDb);
const DAY = 86_400_000;
const now = new Date("2026-11-04T12:00:00Z");

describe("forecast", () => {
  it("flags fewer than 5 sales as low confidence and applies the trend", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 10000 });
    await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 0, platformFee: 0, capturedAt: new Date(now.getTime() - 40 * DAY) });
    await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 0, platformFee: 0, capturedAt: new Date(now.getTime() - 5 * DAY) });
    await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 0, platformFee: 0, capturedAt: new Date(now.getTime() - 3 * DAY) });
    const f = await forecastEarnings(seller.id, { horizonDays: 28 }, "en-US", now);
    const usd = f.forecasts[0]!;
    // recent 20000, prior 10000, trend +100% capped at 50%: 20000 * (1 + 0.25)
    expect(usd).toMatchObject({ low_confidence: true, sales_in_last_56_days: 3, trend_percent: 100, forecast_net_earnings: { amount_minor: 25000 } });
  });
});

describe("anomalies", () => {
  it("applies each rule", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer({ name: "Repeat Refunder" });
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 10000 });
    const a = await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 400, capturedAt: new Date(now.getTime() - 3 * DAY) });
    const b = await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 400, capturedAt: new Date(now.getTime() - 3 * DAY) });
    await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 400, capturedAt: new Date(now.getTime() - 3 * DAY) });
    await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 900, capturedAt: new Date(now.getTime() - 3 * DAY) }); // fee spike
    for (const o of [a, b]) {
      await prisma.refund.create({
        data: { payment_id: o.payment.id, order_id: o.order.id, seller_id: seller.id, currency: "USD", amount_minor: 1000, reason: "r", status: "COMPLETED", seller_debit_minor: 950, created_at: new Date(now.getTime() - DAY) },
      });
    }
    for (let i = 0; i < 3; i++) {
      await prisma.payment.create({
        data: { order_id: a.order.id, seller_id: seller.id, paypal_order_id: `F-${i}`, invoice_id: `F-${i}`, status: "DECLINED", currency: "USD", gross_minor: 10000, created_at: new Date(now.getTime() - DAY) },
      });
    }
    const schedule = await prisma.payoutSchedule.create({ data: { seller_id: seller.id, currency: "USD", status: "APPROVED" } });
    await prisma.payout.create({
      data: { schedule_id: schedule.id, seller_id: seller.id, currency: "USD", amount_minor: 1000, fee_minor: 20, receiver_email: "x@y", scheduled_for: now, status: "FAILED", sender_batch_id: "sb-1", error: "RECEIVER_UNREGISTERED" },
    });

    const res = await detectAnomalies(seller.id, "en-US", now);
    const types = res.anomalies.map((x) => x.type).sort();
    expect(types).toEqual(["failed_payments", "failed_payout", "fee_spike", "listing_refund_rate", "repeat_refunds"]);
    expect(res.anomalies.find((x) => x.type === "repeat_refunds")!.summary).toContain("Repeat Refunder");
  });

  it("reports nothing for a clean history", async () => {
    const seller = await makeSeller();
    expect((await detectAnomalies(seller.id, "en-US", now)).anomalies).toEqual([]);
  });
});

describe("earnings by market", () => {
  it("groups by market and period and subtracts refund debits", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const p = await makeProduct(seller.id);
    const us = await makeListing(seller.id, p.id, { price_minor: 10000 });
    const de = await makeListing(seller.id, p.id, { locale: "de-DE", price_minor: 9999 });
    const lastMonth = new Date("2026-10-15T10:00:00Z");
    await makePaidOrder(seller.id, buyer.id, us, { paypalFee: 400, platformFee: 500, capturedAt: lastMonth });
    const g = await makePaidOrder(seller.id, buyer.id, de, { paypalFee: 400, platformFee: 500, capturedAt: lastMonth });
    await makePaidOrder(seller.id, buyer.id, de, { paypalFee: 400, platformFee: 500, capturedAt: new Date("2026-11-02T10:00:00Z") });
    await prisma.refund.create({
      data: { payment_id: g.payment.id, order_id: g.order.id, seller_id: seller.id, currency: "EUR", amount_minor: 1000, reason: "r", status: "COMPLETED", seller_debit_minor: 950, created_at: new Date("2026-10-20T00:00:00Z") },
    });
    const period = resolvePeriod({ preset: "last_month" }, now);
    expect(period.label).toContain("2026-10-01 to 2026-10-31");
    const res = await earningsByMarket(seller.id, period, "en-US", "de-DE");
    expect(res.markets).toHaveLength(1);
    expect(res.markets[0]).toMatchObject({
      market: "de-DE",
      orders: 1,
      gross_sales: { amount_minor: 9999 },
      net_earnings: { amount_minor: 9099 },
      refund_debits: { amount_minor: 950 },
      net_after_refunds: { amount_minor: 8149, display: "€81.49" },
    });
  });
});

describe("operations views", () => {
  it("shows order details and what is still refundable, scoped to the seller", async () => {
    const seller = await makeSeller();
    const other = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 10000 });
    const o = await makePaidOrder(seller.id, buyer.id, l);
    await prisma.refund.create({
      data: { payment_id: o.payment.id, order_id: o.order.id, seller_id: seller.id, currency: "USD", amount_minor: 2500, reason: "Scratched", status: "COMPLETED", seller_debit_minor: 2375 },
    });
    const d = await orderDetails(seller.id, o.order.id, "en-US");
    expect(d.refunds[0]).toMatchObject({ reason: "Scratched", amount: { display: "$25.00" } });
    expect((await paymentStatus(seller.id, o.order.id, "en-US")).still_refundable.amount_minor).toBe(7500);
    await expect(orderDetails(other.id, o.order.id, "en-US")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("catalog and pricing", () => {
  it("quotes a price from cost, FX and fees with display strings", async () => {
    const seller = await makeSeller({ country: "DE", currency: "EUR", locale: "de-DE" });
    const p = await makeProduct(seller.id, { cost_minor: 4500, shipping_minor: 1500, cost_currency: "EUR", margin_bps: 3500 });
    const q = await quotePrice(seller.id, { productId: p.id, locale: "ja-JP" }, fakeFx({ "EUR->JPY": 170 }));
    expect(q.landed_cost.amount_minor).toBe(10200);
    expect(q.suggested_price.amount_minor % 10).toBe(0);
    expect(q.margin_percent).toBeGreaterThanOrEqual(35);
    expect(q.suggested_price.display).toMatch(/￥|¥/);
    expect(q.fees_are_estimates).toBe(true);
    await expect(quotePrice(seller.id, { productId: p.id, locale: "ja-JP", competitorLow: "1000" }, fakeFx({ "EUR->JPY": 170 }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("enforces ownership, SEO length, and moves an edited published listing to DRAFT", async () => {
    const seller = await makeSeller();
    const mallory = await makeSeller();
    const p = await makeProduct(seller.id);
    await expect(productView(mallory.id, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const draft = { productId: p.id, locale: "de-DE", title: "Brett", description: "Ein Brett.", seoTitle: "x".repeat(71), priceMinor: 4999, pricing: null };
    await expect(saveListingDraft(seller.id, draft)).rejects.toMatchObject({ message: expect.stringContaining("71 characters") });
    const saved = await saveListingDraft(seller.id, { ...draft, seoTitle: "Walnussbrett" });
    await prisma.listing.update({ where: { id: saved.id }, data: { status: "PUBLISHED" } });
    const again = await saveListingDraft(seller.id, { ...draft, seoTitle: "Walnussbrett", title: "Brett 2" });
    expect(again).toMatchObject({ id: saved.id, status: "DRAFT", currency: "EUR" });
    await prisma.listing.update({ where: { id: saved.id }, data: { status: "PUBLISHED" } });
    const edited = await editListing(seller.id, saved.id, { title: "T", description: "D", seo_title: "S", price: "59.99" });
    expect(edited).toMatchObject({ status: "DRAFT", price_minor: 5999, pricing: null });
  });

  it("compares GlobalCart with selling direct and shows both columns", async () => {
    const seller = await makeSeller();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { locale: "ja-JP", price_minor: 7980 });
    const c = await compareSellingDirect(seller.id, { listingId: l.id }, fakeFx({ "JPY->USD": 0.0066 }));
    expect(c.globalcart.platform_fee.amount_minor).toBe(399);
    expect(c.direct_store.platform_fee.amount_minor).toBe(0);
    expect(c.direct_store.buyer_pays.currency).toBe("USD");
    expect(typeof c.difference_for_seller.globalcart_nets_more).toBe("boolean");
  });
});

describe("search", () => {
  it("embeds published listings and searches only the buyer's market", async () => {
    const seller = await makeSeller();
    const p = await makeProduct(seller.id);
    const us = await makeListing(seller.id, p.id, { title: "Walnut board" });
    const jp = await makeListing(seller.id, p.id, { locale: "ja-JP", title: "ウォールナットボード", price_minor: 7980 });
    const draft = await makeListing(seller.id, (await makeProduct(seller.id)).id, { status: "DRAFT" });
    const v = (x: number) => Array.from({ length: 1024 }, (_, i) => (i === 0 ? x : 0.001));
    const embedder = { embed: vi.fn(async (texts: string[], _type: "document" | "query") => texts.map(() => v(1))) };
    expect(await embedListing(us.id, embedder)).toBe("EMBEDDED");
    expect(await embedListing(jp.id, embedder)).toBe("EMBEDDED");
    expect(await embedListing(draft.id, embedder)).toBe("SKIPPED");
    expect(embedder.embed.mock.calls[0]![1]).toBe("document");

    const hits = await searchListings("ja-JP", "まな板", 5, embedder);
    expect(hits.map((h) => h.listing_id)).toEqual([jp.id]);
    expect(hits[0]!.price.display).toMatch(/7,980/);
    expect(embedder.embed.mock.calls.at(-1)![1]).toBe("query");
  });
});

describe("webhooks", () => {
  it("stores each event once and settles a pending capture", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 4999 });
    const { payment, order } = await makePaidOrder(seller.id, buyer.id, l);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "PENDING", net_to_seller_minor: null, paypal_fee_minor: null } });
    await prisma.order.update({ where: { id: order.id }, data: { status: "PENDING_PAYMENT" } });
    const event = {
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_type: "capture",
      resource: {
        id: payment.capture_id,
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "49.99" },
        seller_receivable_breakdown: { gross_amount: { currency_code: "USD", value: "49.99" }, paypal_fee: { currency_code: "USD", value: "2.23" } },
        supplementary_data: { related_ids: { order_id: payment.paypal_order_id } },
      },
    };
    expect(await storeWebhookEvent(event)).toBe(true);
    expect(await storeWebhookEvent(event)).toBe(false);
    expect(await processWebhookEvent("WH-1")).toEqual({ status: "PROCESSED" });
    expect(await processWebhookEvent("WH-1")).toEqual({ status: "SKIPPED" });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p).toMatchObject({ status: "COMPLETED", paypal_fee_minor: 223, platform_fee_minor: 250, net_to_seller_minor: 4999 - 223 - 250 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
  });

  it("records a refund made outside GlobalCart and ignores unknown event types", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 10000 });
    const { payment, order } = await makePaidOrder(seller.id, buyer.id, l, { platformFee: 500 });
    await storeWebhookEvent({
      id: "WH-R",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "EXT-REF",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "100.00" },
        links: [{ href: `https://api.sandbox.paypal.com/v2/payments/captures/${payment.capture_id}`, rel: "up", method: "GET" }],
      },
    });
    await processWebhookEvent("WH-R");
    const r = await prisma.refund.findUniqueOrThrow({ where: { paypal_refund_id: "EXT-REF" } });
    expect(r).toMatchObject({ amount_minor: 10000, platform_fee_returned_minor: 500, seller_debit_minor: 9500, status: "COMPLETED" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");

    await storeWebhookEvent({ id: "WH-X", event_type: "CHECKOUT.ORDER.APPROVED", resource: {} });
    expect(await processWebhookEvent("WH-X")).toMatchObject({ status: "IGNORED" });
  });
});

describe("audit", () => {
  it("writes an agent_actions row for every PayPal call", async () => {
    const seller = await makeSeller();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/token")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
        : new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 }),
    );
    const client = new PayPalClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      record: recordPayPalCall,
      config: () => ({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b", PAYPAL_BRAND_NAME: "GC", baseUrl: "https://x.test" }),
    });
    await expect(client.getOrder({ actor: "SELLER", actorId: seller.id, sellerId: seller.id }, "NOPE")).rejects.toThrow();
    const rows = await prisma.agentAction.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "PAYPAL", tool: "paypal.orders.get", status: "FAILED", seller_id: seller.id });
    expect(rows[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
