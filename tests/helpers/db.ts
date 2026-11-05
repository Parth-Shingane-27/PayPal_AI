import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { getMarket } from "@/server/domain/markets";

/** Empties every table in the test database. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    agent_actions, agent_sessions, webhook_events, payouts, payout_schedules, refunds, payments,
    order_items, orders, listings, products, buyers, sellers RESTART IDENTITY CASCADE`);
}

let n = 0;
const uniq = () => `${Date.now()}-${++n}`;

export async function makeSeller(over: Partial<{ country: string; currency: string; locale: string; name: string }> = {}) {
  return prisma.seller.create({
    data: {
      name: over.name ?? `Seller ${uniq()}`,
      email: `seller-${uniq()}@test.local`,
      paypal_email: `payouts-${uniq()}@test.local`,
      country: over.country ?? "US",
      currency: over.currency ?? "USD",
      locale: over.locale ?? "en-US",
    },
  });
}

export async function makeBuyer(over: Partial<{ locale: string; country: string; name: string }> = {}) {
  return prisma.buyer.create({
    data: {
      name: over.name ?? `Buyer ${uniq()}`,
      email: `buyer-${uniq()}@test.local`,
      locale: over.locale ?? "en-US",
      country: over.country ?? "US",
    },
  });
}

export async function makeProduct(sellerId: string, over: Partial<{ cost_minor: number; shipping_minor: number; cost_currency: string; margin_bps: number; sku: string }> = {}) {
  return prisma.product.create({
    data: {
      seller_id: sellerId,
      sku: over.sku ?? `SKU-${uniq()}`,
      title: "Walnut board",
      description: "A board carved from walnut.",
      source_locale: "en-US",
      cost_minor: over.cost_minor ?? 1800,
      shipping_minor: over.shipping_minor ?? 900,
      cost_currency: over.cost_currency ?? "USD",
      margin_bps: over.margin_bps ?? 3000,
      attributes: { material: "walnut", weight_kg: 0.95 },
    },
  });
}

export async function makeListing(
  sellerId: string,
  productId: string,
  over: Partial<{ locale: string; price_minor: number; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; title: string }> = {},
) {
  const locale = over.locale ?? "en-US";
  return prisma.listing.create({
    data: {
      product_id: productId,
      seller_id: sellerId,
      locale,
      currency: getMarket(locale).currency,
      title: over.title ?? "Walnut Serving Board",
      description: "Hand-carved walnut board.",
      seo_title: "Walnut Serving Board",
      price_minor: over.price_minor ?? 4999,
      status: over.status ?? "PUBLISHED",
    },
  });
}

/** A captured order with a COMPLETED payment (real-looking capture id). */
export async function makePaidOrder(
  sellerId: string,
  buyerId: string,
  listing: { id: string; title: string; price_minor: number; currency: string; locale: string },
  over: Partial<{ quantity: number; paypalFee: number; platformFee: number; capturedAt: Date; captureId: string }> = {},
) {
  const qty = over.quantity ?? 1;
  const gross = listing.price_minor * qty;
  const paypalFee = over.paypalFee ?? Math.round(gross * 0.0349) + 49;
  const platformFee = over.platformFee ?? Math.round(gross * 0.05);
  const at = over.capturedAt ?? new Date();
  const order = await prisma.order.create({
    data: {
      buyer_id: buyerId,
      seller_id: sellerId,
      currency: listing.currency,
      locale: listing.locale,
      status: "PAID",
      paid_at: at,
      created_at: at,
      items: { create: { listing_id: listing.id, title: listing.title, sku: "SKU", unit_price_minor: listing.price_minor, quantity: qty } },
    },
  });
  const payment = await prisma.payment.create({
    data: {
      order_id: order.id,
      seller_id: sellerId,
      paypal_order_id: `PP-${randomUUID()}`,
      invoice_id: `${order.id}-${randomUUID()}`,
      status: "COMPLETED",
      currency: listing.currency,
      gross_minor: gross,
      paypal_fee_minor: paypalFee,
      platform_fee_minor: platformFee,
      fx_cost_minor: 0,
      net_to_seller_minor: gross - paypalFee - platformFee,
      capture_id: over.captureId ?? `CAP-${randomUUID()}`,
      captured_at: at,
      created_at: at,
    },
  });
  return { order, payment };
}

export const sellerAudit = (sellerId: string) => ({ actor: { type: "SELLER" as const, sellerId }, agent: "OPERATIONS" as const, sessionId: null });
export const buyerAudit = (buyerId: string) => ({ actor: { type: "BUYER" as const, buyerId }, agent: null, sessionId: null });
