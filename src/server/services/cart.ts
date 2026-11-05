import type { OrderStatus } from "@/generated/prisma/client";
import { type Tx, prisma } from "../db";
import { money } from "../domain/money";
import { AppError, notFound } from "../errors";
import { lockBuyer } from "./locks";

/**
 * A cart is the open order for one (buyer, seller, currency): status CART, or
 * PENDING_PAYMENT while a PayPal checkout is in progress. There is at most one
 * open order per tuple; every change locks the buyer row (FOR UPDATE) so
 * concurrent requests cannot create two.
 *
 * Changing an order that is PENDING_PAYMENT turns it back into a CART and
 * voids its pending payment locally, so an old PayPal approval for a
 * different amount can never be captured.
 */

export const OPEN_STATUSES: OrderStatus[] = ["CART", "PENDING_PAYMENT"];
export const MAX_QUANTITY = 20;

/** Back to CART; pending payments for the old amount are voided. */
async function reopen(tx: Tx, orderId: string, status: OrderStatus): Promise<void> {
  if (status === "PENDING_PAYMENT") {
    await tx.payment.updateMany({ where: { order_id: orderId, status: "CREATED" }, data: { status: "VOIDED" } });
    await tx.order.update({ where: { id: orderId }, data: { status: "CART" } });
  }
}

export async function addToCart(buyerId: string, locale: string, listingId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new AppError("INVALID_INPUT", `Quantity must be between 1 and ${MAX_QUANTITY}.`);
  }
  await prisma.$transaction(async (tx) => {
    await lockBuyer(tx, buyerId);
    const listing = await tx.listing.findFirst({
      where: { id: listingId, locale, status: "PUBLISHED" },
      include: { product: true },
    });
    if (!listing) throw notFound("Listing");

    let order = await tx.order.findFirst({
      where: { buyer_id: buyerId, seller_id: listing.seller_id, currency: listing.currency, status: { in: OPEN_STATUSES } },
    });
    if (order) await reopen(tx, order.id, order.status);
    else {
      order = await tx.order.create({
        data: { buyer_id: buyerId, seller_id: listing.seller_id, currency: listing.currency, locale, status: "CART" },
      });
    }

    const existing = await tx.orderItem.findUnique({ where: { order_id_listing_id: { order_id: order.id, listing_id: listing.id } } });
    const newQty = (existing?.quantity ?? 0) + quantity;
    if (newQty > MAX_QUANTITY) throw new AppError("INVALID_INPUT", `At most ${MAX_QUANTITY} of one item per order.`);
    const snapshot = { title: listing.title, sku: listing.product.sku, unit_price_minor: listing.price_minor };
    await tx.orderItem.upsert({
      where: { order_id_listing_id: { order_id: order.id, listing_id: listing.id } },
      create: { order_id: order.id, listing_id: listing.id, quantity: newQty, ...snapshot },
      update: { quantity: newQty, ...snapshot },
    });
  });
  return viewCart(buyerId);
}

/** Sets an item's quantity; 0 removes it. An emptied cart is deleted. */
export async function updateCart(buyerId: string, listingId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
    throw new AppError("INVALID_INPUT", `Quantity must be between 0 and ${MAX_QUANTITY}.`);
  }
  await prisma.$transaction(async (tx) => {
    await lockBuyer(tx, buyerId);
    const item = await tx.orderItem.findFirst({
      where: { listing_id: listingId, order: { buyer_id: buyerId, status: { in: OPEN_STATUSES } } },
      include: { order: true },
    });
    if (!item) throw notFound("Cart item");
    await reopen(tx, item.order_id, item.order.status);
    if (quantity === 0) {
      await tx.orderItem.delete({ where: { id: item.id } });
      const left = await tx.orderItem.count({ where: { order_id: item.order_id } });
      const hasPayments = await tx.payment.count({ where: { order_id: item.order_id } });
      if (left === 0 && hasPayments === 0) await tx.order.delete({ where: { id: item.order_id } });
    } else {
      await tx.orderItem.update({ where: { id: item.id }, data: { quantity } });
    }
  });
  return viewCart(buyerId);
}

export async function viewCart(buyerId: string) {
  const orders = await prisma.order.findMany({
    where: { buyer_id: buyerId, status: { in: OPEN_STATUSES }, items: { some: {} } },
    include: { items: { orderBy: { title: "asc" } }, seller: true },
    orderBy: { created_at: "asc" },
  });
  return {
    carts: orders.map((o) => {
      const total = o.items.reduce((s, i) => s + i.unit_price_minor * i.quantity, 0);
      return {
        cart_id: o.id,
        seller: o.seller.name,
        currency: o.currency,
        status: o.status === "CART" ? "OPEN" : "CHECKOUT_STARTED",
        items: o.items.map((i) => ({
          listing_id: i.listing_id,
          title: i.title,
          quantity: i.quantity,
          unit_price: money(i.unit_price_minor, o.currency, o.locale),
          line_total: money(i.unit_price_minor * i.quantity, o.currency, o.locale),
        })),
        total: money(total, o.currency, o.locale),
        prices_include_shipping: true,
      };
    }),
    note: "Each cart is one seller and one currency and is paid with its own PayPal checkout.",
  };
}
