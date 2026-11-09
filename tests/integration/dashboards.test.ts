import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/server/auth";
import { prisma } from "@/server/db";
import { buyerOverview, buyerPurchaseRows, opsTrend, sellerOverview, sellerProductRows, sellerSalesRows } from "@/server/services/analytics";
import { earningsByMarket, resolvePeriod } from "@/server/services/ledger";
import { treasuryOverview } from "@/server/services/treasury";
import { getConversation, listConversations, markRead, sendMessage, startConversation, unreadCount } from "@/server/services/messages";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb } from "../helpers/db";

beforeEach(resetDb);

const asSeller = (s: { id: string; name: string; locale: string }): Principal => ({ role: "SELLER", sellerId: s.id, name: s.name, locale: s.locale });
const asBuyer = (b: { id: string; name: string; locale: string }): Principal => ({ role: "BUYER", buyerId: b.id, name: b.name, market: b.locale });

async function world() {
  const seller = await makeSeller();
  const other = await makeSeller();
  const buyer = await makeBuyer();
  const product = await makeProduct(seller.id);
  const listing = await makeListing(seller.id, product.id, { price_minor: 10000 });
  return { seller, other, buyer, product, listing };
}

describe("seller analytics", () => {
  it("sales rows reconcile with the ledger's earnings by market", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { quantity: 2, paypalFee: 700, platformFee: 1000 });
    const otherListing = await makeListing(w.other.id, (await makeProduct(w.other.id)).id);
    await makePaidOrder(w.other.id, w.buyer.id, otherListing);

    const period = resolvePeriod({ preset: "last_30_days" });
    const sales = await sellerSalesRows(w.seller.id, period);
    expect(sales.rows).toHaveLength(2);
    const earnings = await earningsByMarket(w.seller.id, period, "en-US");
    const netFromRows = sales.rows.reduce((s, r) => s + r.net.amount_minor, 0);
    expect(netFromRows).toBe(earnings.markets[0]!.net_after_refunds.amount_minor);
    expect(netFromRows).toBe(10000 - 900 + 20000 - 1700);
  });

  it("product rows allocate net to products and count traffic", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 0, platformFee: 0 });
    await prisma.listingDailyStat.create({ data: { listing_id: w.listing.id, day: new Date(new Date().toISOString().slice(0, 10)), views: 50, cart_adds: 4 } });
    const rows = await sellerProductRows(w.seller.id, resolvePeriod({ preset: "last_30_days" }));
    expect(rows.rows[0]).toMatchObject({ orders: 1, units: 1, views: 50, conversion_bps: 200, net_home: { amount_minor: 10000 } });
  });

  it("overview fee anatomy sums to gross", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const o = await sellerOverview(w.seller.id, resolvePeriod({ preset: "last_30_days" }));
    const a = o.fee_anatomy;
    expect(a.gross.amount_minor).toBe(a.net.amount_minor + a.paypal_fees.amount_minor + a.platform_fees.amount_minor + a.fx_costs.amount_minor + a.refunds.amount_minor);
    expect(o.kpis.orders).toBe(1);
  });

  it("buyer views only include the buyer's own orders", async () => {
    const w = await world();
    const someoneElse = await makeBuyer();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    await makePaidOrder(w.seller.id, someoneElse.id, w.listing);
    const rows = await buyerPurchaseRows(w.buyer.id, "en-US");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.reached_maker.amount_minor).toBe(9100);
    const o = await buyerOverview(w.buyer.id, "en-US");
    expect(o.kpis).toMatchObject({ orders: 1, makers: 1 });
  });
});

describe("partial month", () => {
  it("flags only the current month in the seller and buyer series", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const now = new Date();
    const o = await sellerOverview(w.seller.id, resolvePeriod({ preset: "last_30_days" }), now);
    const flags = o.monthly.map((m) => m.partial);
    expect(flags.slice(0, -1).every((f) => f === false)).toBe(true);
    expect(o.monthly[o.monthly.length - 1]).toMatchObject({ partial: true, days_elapsed: now.getUTCDate() });
    const b = await buyerOverview(w.buyer.id, "en-US", now);
    expect(b.monthly[b.monthly.length - 1]!.partial).toBe(true);
  });
});

describe("opsTrend", () => {
  it("counts refunded paid orders and failed payments in the week they happened", async () => {
    const w = await world();
    const now = new Date("2026-11-09T12:00:00Z");
    const DAY = 86_400_000;
    const thisWeek = await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { capturedAt: new Date(now.getTime() - 2 * DAY) });
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { capturedAt: new Date(now.getTime() - 3 * DAY) });
    await prisma.refund.create({
      data: { payment_id: thisWeek.payment.id, order_id: thisWeek.order.id, seller_id: w.seller.id, currency: "USD", amount_minor: 1000, reason: "r", status: "COMPLETED", seller_debit_minor: 900 },
    });
    await prisma.order.create({ data: { buyer_id: w.buyer.id, seller_id: w.seller.id, currency: "USD", locale: "en-US", status: "PENDING_PAYMENT", created_at: new Date(now.getTime() - 9 * DAY) } });
    const old = await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { capturedAt: new Date(now.getTime() - 200 * DAY) });
    expect(old.order.id).toBeTruthy();

    const { weeks } = await opsTrend(w.seller.id, 12, now);
    expect(weeks).toHaveLength(12);
    const last = weeks[11]!;
    expect(last).toMatchObject({ orders: 2, refunded_orders: 1, refund_rate_bps: 5000, declined: 0 });
    expect(weeks[10]).toMatchObject({ declined: 1, orders: 0, refund_rate_bps: null });
    // The order from 200 days ago is outside the 12 weeks.
    expect(weeks.reduce((s, x) => s + x.orders, 0)).toBe(2);
  });
});

describe("treasuryOverview", () => {
  it("shows how far the available balance is from the fee cap, closest currency first", async () => {
    const w = await world();
    // 100.00 USD gross, no fees: far below the USD cap threshold of 1,000.00.
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 0, platformFee: 0 });
    const o = await treasuryOverview(w.seller.id, "en-US");
    const usd = o.cards.find((c) => c.currency === "USD")!;
    expect(usd).toMatchObject({ cap_reached: false, readiness_bps: 1000 });
    expect(usd.available.amount_minor).toBe(10000);
    expect(usd.fee_cap_threshold.amount_minor).toBe(100000);
    expect(usd.until_cap.amount_minor).toBe(90000);
    // The payout fee is 2% of the payout, taken from the same balance: payout + fee fits within available.
    expect(usd.payout_amount.amount_minor + usd.estimated_payout_fee.amount_minor).toBeLessThanOrEqual(10000);
    expect(o.forecasts.length).toBeGreaterThan(0);
  });

  it("marks the cap as reached once available covers it", async () => {
    const w = await world();
    const big = await makeListing(w.seller.id, (await makeProduct(w.seller.id)).id, { price_minor: 150_000 });
    await makePaidOrder(w.seller.id, w.buyer.id, big, { paypalFee: 0, platformFee: 0 });
    const usd = (await treasuryOverview(w.seller.id, "en-US")).cards.find((c) => c.currency === "USD")!;
    expect(usd).toMatchObject({ cap_reached: true, readiness_bps: 10000 });
    expect(usd.until_cap.amount_minor).toBe(0);
  });
});

describe("messages", () => {
  it("lets a buyer ask a maker, tracks unread on both sides, and hides threads from other sellers", async () => {
    const w = await world();
    const buyer = asBuyer(w.buyer);
    const seller = asSeller(w.seller);
    const { id } = await startConversation(buyer, { product_id: w.product.id, body: "Does this ship to Canada?" });

    expect(await unreadCount(seller)).toBe(1);
    expect((await listConversations(seller))[0]).toMatchObject({ id, unread: 1, counterpart: { name: w.buyer.name } });

    await sendMessage(seller, id, "Yes, in about a week.");
    expect(await unreadCount(buyer)).toBe(1);
    expect(await unreadCount(seller)).toBe(0);

    await markRead(buyer, id);
    expect(await unreadCount(buyer)).toBe(0);

    const thread = await getConversation(buyer, id);
    expect(thread.messages.map((m) => [m.from_me, m.body])).toEqual([
      [true, "Does this ship to Canada?"],
      [false, "Yes, in about a week."],
    ]);

    const intruder = asSeller(w.other);
    await expect(getConversation(intruder, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sendMessage(intruder, id, "hi")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sendMessage(seller, id, "   ")).rejects.toThrow();
  });

  it("reuses an open thread for the same product and refuses sellers starting threads", async () => {
    const w = await world();
    const buyer = asBuyer(w.buyer);
    const a = await startConversation(buyer, { product_id: w.product.id, body: "First" });
    const b = await startConversation(buyer, { product_id: w.product.id, body: "Second" });
    expect(b.id).toBe(a.id);
    await expect(startConversation(asSeller(w.seller), { product_id: w.product.id, body: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
