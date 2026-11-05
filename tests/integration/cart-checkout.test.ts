import { beforeEach, describe, expect, it } from "vitest";
import { PayPalApiError } from "@/server/clients/paypal";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { addToCart, updateCart, viewCart } from "@/server/services/cart";
import { captureCheckout, startCheckout } from "@/server/services/checkout";
import { buyerAudit, makeBuyer, makeListing, makeProduct, makeSeller, resetDb } from "../helpers/db";
import { fakeFx, fakePayPal } from "../helpers/fakes";

beforeEach(resetDb);

async function world() {
  const seller = await makeSeller();
  const other = await makeSeller({ country: "DE", currency: "EUR", locale: "de-DE" });
  const buyer = await makeBuyer();
  const p1 = await makeProduct(seller.id);
  const p2 = await makeProduct(other.id, { cost_currency: "EUR" });
  const l1 = await makeListing(seller.id, p1.id, { price_minor: 4999 });
  const l2 = await makeListing(other.id, p2.id, { price_minor: 13999, title: "Cuckoo clock" });
  const jp = await makeListing(seller.id, p1.id, { locale: "ja-JP", price_minor: 7980 });
  return { seller, other, buyer, l1, l2, jp };
}

describe("cart", () => {
  it("keeps one cart per seller and currency", async () => {
    const w = await world();
    await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    await addToCart(w.buyer.id, "en-US", w.l1.id, 2);
    const cart = await addToCart(w.buyer.id, "en-US", w.l2.id, 1);
    expect(cart.carts).toHaveLength(2);
    const mine = cart.carts.find((c) => c.items[0]!.listing_id === w.l1.id)!;
    expect(mine.items[0]!.quantity).toBe(3);
    expect(mine.total.amount_minor).toBe(3 * 4999);
    expect(mine.total.display).toBe("$149.97");
  });

  it("never creates two open orders under concurrent adds", async () => {
    const w = await world();
    await Promise.all(Array.from({ length: 6 }, () => addToCart(w.buyer.id, "en-US", w.l1.id, 1)));
    const open = await prisma.order.findMany({ where: { buyer_id: w.buyer.id, status: { in: ["CART", "PENDING_PAYMENT"] } }, include: { items: true } });
    expect(open).toHaveLength(1);
    expect(open[0]!.items[0]!.quantity).toBe(6);
  });

  it("only sells listings that are published in the buyer's market", async () => {
    const w = await world();
    await expect(addToCart(w.buyer.id, "en-US", w.jp.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const draft = await makeListing(w.seller.id, (await makeProduct(w.seller.id)).id, { status: "DRAFT" });
    await expect(addToCart(w.buyer.id, "en-US", draft.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removes items and deletes an emptied cart", async () => {
    const w = await world();
    await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    const after = await updateCart(w.buyer.id, w.l1.id, 0);
    expect(after.carts).toHaveLength(0);
    expect(await prisma.order.count({ where: { buyer_id: w.buyer.id } })).toBe(0);
  });

  it("does not let one buyer touch another buyer's cart", async () => {
    const w = await world();
    const mallory = await makeBuyer();
    await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    await expect(updateCart(mallory.id, w.l1.id, 5)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("checkout", () => {
  it("creates a PayPal order for the cart total and moves it to PENDING_PAYMENT", async () => {
    const w = await world();
    const pp = fakePayPal();
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 2);
    const res = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    expect(res).toMatchObject({ reused: false, total: { amount_minor: 9998 } });
    expect(res.approve_url).toContain("checkoutnow");
    const input = pp.calls[0]!.args[1] as { invoiceId: string; orderId: string; totalMinor: number; returnUrl: string };
    expect(input.invoiceId.startsWith(`${carts[0]!.cart_id}-`)).toBe(true);
    expect(input.totalMinor).toBe(9998);
    expect(input.returnUrl).toContain("/checkout/return");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: carts[0]!.cart_id }, include: { payments: true } });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payments[0]).toMatchObject({ status: "CREATED", gross_minor: 9998, seller_id: w.seller.id });
  });

  it("reuses a pending PayPal order, and starts over when PayPal lost it", async () => {
    const w = await world();
    const pp = fakePayPal();
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    const first = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    const again = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    expect(again).toMatchObject({ reused: true, paypal_order_id: first.paypal_order_id });
    expect(pp.count("createOrder")).toBe(1);

    pp.orders.delete(first.paypal_order_id); // PayPal now answers 404
    const third = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    expect(third.reused).toBe(false);
    expect(third.paypal_order_id).not.toBe(first.paypal_order_id);
    const statuses = (await prisma.payment.findMany({ where: { order_id: carts[0]!.cart_id }, orderBy: { created_at: "asc" } })).map((p) => p.status);
    expect(statuses).toEqual(["VOIDED", "CREATED"]);
  });

  it("voids a pending payment when the cart changes", async () => {
    const w = await world();
    const pp = fakePayPal();
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    const started = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: carts[0]!.cart_id } })).status).toBe("CART");
    await expect(captureCheckout(w.buyer.id, started.paypal_order_id, buyerAudit(w.buyer.id), { paypal: pp.api })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { restart: true },
    });
    expect(pp.count("captureOrder")).toBe(0);
  });

  it("refreshes a changed price before creating the PayPal order", async () => {
    const w = await world();
    const pp = fakePayPal();
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    await prisma.listing.update({ where: { id: w.l1.id }, data: { price_minor: 5499 } });
    const res = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    expect(res).toMatchObject({ prices_updated: true, total: { amount_minor: 5499 } });
  });

  it("captures once, records PayPal's actual fee and the platform fee", async () => {
    const w = await world();
    const pp = fakePayPal();
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    const s = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    const out = await captureCheckout(w.buyer.id, s.paypal_order_id, buyerAudit(w.buyer.id), { paypal: pp.api, fx: fakeFx() });
    expect(out).toMatchObject({ order_status: "PAID", payment_status: "COMPLETED" });
    const pay = await prisma.payment.findFirstOrThrow({ where: { paypal_order_id: s.paypal_order_id } });
    const fee = Math.round(4999 * 0.0349) + 49;
    expect(pay).toMatchObject({ paypal_fee_minor: fee, fee_is_estimate: false, platform_fee_minor: 250, fx_cost_minor: 0, net_to_seller_minor: 4999 - fee - 250 });

    const again = await captureCheckout(w.buyer.id, s.paypal_order_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    expect(again.already_captured).toBe(true);
    expect(pp.count("captureOrder")).toBe(1);
    expect(pp.calls.find((c) => c.op === "captureOrder")!.args[2]).toBe(`capture-${pay.id}`);
  });

  it("falls back to an estimated fee when PayPal's fee is in another currency", async () => {
    const w = await world();
    const pp = fakePayPal();
    pp.api.captureOrder = async (_ctx, id) => ({
      paypalOrderId: id, captureId: "CAP-X", status: "COMPLETED", currency: "USD", grossMinor: 4999, paypalFeeMinor: null, alreadyCaptured: false,
    });
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    const s = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    await captureCheckout(w.buyer.id, s.paypal_order_id, buyerAudit(w.buyer.id), { paypal: pp.api, fx: fakeFx() });
    const pay = await prisma.payment.findFirstOrThrow({ where: { paypal_order_id: s.paypal_order_id } });
    expect(pay.fee_is_estimate).toBe(true);
    expect(pay.paypal_fee_minor).toBe(Math.round(4999 * 0.0349) + 49);
  });

  it("measures FX cost against the mid rate when PayPal converted the money", async () => {
    const w = await world();
    const pp = fakePayPal();
    pp.api.captureOrder = async (_ctx, id) => ({
      paypalOrderId: id, captureId: "CAP-JP", status: "COMPLETED", currency: "JPY", grossMinor: 7980, paypalFeeMinor: 318,
      conversion: { netMinor: 7662, receivableCurrency: "USD", receivableMinor: 4900, rate: 0.0064 }, alreadyCaptured: false,
    });
    const jpBuyer = await makeBuyer({ locale: "ja-JP", country: "JP" });
    const { carts } = await addToCart(jpBuyer.id, "ja-JP", w.jp.id, 1);
    const s = await startCheckout(jpBuyer.id, carts[0]!.cart_id, buyerAudit(jpBuyer.id), { paypal: pp.api });
    await captureCheckout(jpBuyer.id, s.paypal_order_id, buyerAudit(jpBuyer.id), { paypal: pp.api, fx: fakeFx({ "USD->JPY": 150 }) });
    const pay = await prisma.payment.findFirstOrThrow({ where: { paypal_order_id: s.paypal_order_id } });
    // 49.00 USD at the mid rate is 7350 JPY; PayPal's conversion cost 7662 - 7350.
    expect(pay.fx_cost_minor).toBe(312);
    expect(pay.net_to_seller_minor).toBe(7980 - 318 - 399 - 312);
  });

  it("keeps the payment open on INSTRUMENT_DECLINED so the buyer can retry", async () => {
    const w = await world();
    const pp = fakePayPal();
    pp.api.captureOrder = async () => {
      throw new AppError("PAYMENT_DECLINED", "declined", { restart: true });
    };
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    const s = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    await expect(captureCheckout(w.buyer.id, s.paypal_order_id, buyerAudit(w.buyer.id), { paypal: pp.api })).rejects.toMatchObject({ code: "PAYMENT_DECLINED" });
    expect((await prisma.payment.findFirstOrThrow({ where: { paypal_order_id: s.paypal_order_id } })).status).toBe("CREATED");
  });

  it("sends a declined capture back to the cart", async () => {
    const w = await world();
    const pp = fakePayPal();
    pp.api.captureOrder = async (_ctx, id) => ({
      paypalOrderId: id, captureId: "CAP-D", status: "DECLINED", currency: "USD", grossMinor: 4999, paypalFeeMinor: null, alreadyCaptured: false,
    });
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    const s = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    const out = await captureCheckout(w.buyer.id, s.paypal_order_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    expect(out).toMatchObject({ payment_status: "DECLINED", order_status: "CART" });
  });

  it("hides other buyers' carts and payments", async () => {
    const w = await world();
    const pp = fakePayPal();
    const mallory = await makeBuyer();
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    await expect(startCheckout(mallory.id, carts[0]!.cart_id, buyerAudit(mallory.id), { paypal: pp.api })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const s = await startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api });
    await expect(captureCheckout(mallory.id, s.paypal_order_id, buyerAudit(mallory.id), { paypal: pp.api })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await viewCart(mallory.id)).carts).toEqual([]);
  });

  it("propagates unexpected PayPal errors without changing the cart", async () => {
    const w = await world();
    const pp = fakePayPal({
      createOrder: async () => {
        throw new PayPalApiError(500, { name: "INTERNAL_SERVER_ERROR" });
      },
    });
    const { carts } = await addToCart(w.buyer.id, "en-US", w.l1.id, 1);
    await expect(startCheckout(w.buyer.id, carts[0]!.cart_id, buyerAudit(w.buyer.id), { paypal: pp.api })).rejects.toBeInstanceOf(PayPalApiError);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: carts[0]!.cart_id } })).status).toBe("CART");
    expect(await prisma.payment.count()).toBe(0);
  });
});
