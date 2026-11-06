import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/server/auth";
import { prisma } from "@/server/db";
import { buyerOverview, buyerPurchaseRows, sellerOverview, sellerProductRows, sellerSalesRows } from "@/server/services/analytics";
import { earningsByMarket, resolvePeriod } from "@/server/services/ledger";
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
