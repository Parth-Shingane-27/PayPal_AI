import { z } from "zod";
import { AppError } from "../../errors";
import { frankfurter } from "../../clients/frankfurter";
import { convertMinor, money, parseDecimal, SUPPORTED_CURRENCIES } from "../../domain/money";
import { addToCart, MAX_QUANTITY, updateCart, viewCart } from "../../services/cart";
import { prisma } from "../../db";
import { deliveryFor, startCheckout } from "../../services/checkout";
import { publishedListingFacts, searchListings } from "../../services/search";
import { defineTool } from "../tool";
import { buyerOf, decimalAmount, uuid } from "./common";

type Price = { amount_minor: number; currency: string; display: string };

/** Adds `price_usd` (code-computed, ECB rate) to each item. If rates are unreachable the items come back without it. */
async function withUsd<T extends { price: Price }>(items: T[]): Promise<(T & { price_usd?: Price })[]> {
  try {
    return await Promise.all(
      items.map(async (item) => {
        const { rate } = await frankfurter.getRate(item.price.currency, "USD");
        return { ...item, price_usd: money(convertMinor(item.price.amount_minor, item.price.currency, "USD", rate), "USD") };
      }),
    );
  } catch {
    return items;
  }
}

const showInShopTool = defineTool({
  name: "show_in_shop",
  description:
    "Set what the shop page shows. Call once after searching. outcome: 'match' (one clear best product), 'options' (request is not specific and several available products fit: the page numbers them 1, 2, 3 in listing_ids order so the buyer can choose), 'alternatives' (exact item not sold; closest available products in listing_ids), 'none' (nothing relevant; listing_ids empty). Use only ids from search/compare results. `requested` = what the buyer asked for, a few words. Read-only.",
  kind: "read",
  input: z.object({
    outcome: z.enum(["match", "options", "alternatives", "none"]),
    requested: z.string().min(1).max(120),
    listing_ids: z.array(uuid()).max(8),
  }),
  async run(ctx, input) {
    if (input.outcome === "none" && input.listing_ids.length > 0) throw new AppError("INVALID_INPUT", "outcome 'none' takes no listing_ids.");
    if (input.outcome !== "none" && input.listing_ids.length === 0) throw new AppError("INVALID_INPUT", `outcome '${input.outcome}' needs at least one listing_id.`);
    if (input.listing_ids.length) await publishedListingFacts(ctx.locale, input.listing_ids);
    return { outcome: input.outcome, requested: input.requested, listing_ids: input.listing_ids };
  },
});

const getMyOrderTool = defineTool({
  name: "get_my_order",
  description:
    "Confirm payment/order status when the buyer says they paid or asks about an order. order_id from create_paypal_order, or null for the latest. PAID means placed (includes estimated_delivery); never say placed unless PAID. Read-only.",
  kind: "read",
  input: z.object({ order_id: uuid().nullable() }),
  async run(ctx, input) {
    const buyerId = buyerOf(ctx);
    const order = await prisma.order.findFirst({
      where: { buyer_id: buyerId, ...(input.order_id ? { id: input.order_id } : { status: { not: "CART" } }) },
      orderBy: { created_at: "desc" },
      include: { items: true, seller: true, payments: { orderBy: { created_at: "desc" }, take: 1 } },
    });
    if (!order) throw new AppError("NOT_FOUND", "Order not found.");
    const total = order.payments[0] ? money(order.payments[0].gross_minor, order.currency, order.locale) : null;
    return {
      order_id: order.id,
      status: order.status,
      paid_at: order.paid_at,
      seller: order.seller.name,
      items: order.items.map((i) => ({ title: i.title, quantity: i.quantity })),
      total,
      estimated_delivery: await deliveryFor(order.id),
    };
  },
});

const convertToUsdTool = defineTool({
  name: "convert_to_usd",
  description:
    "Convert an amount in USD, GBP, CAD, AUD, EUR, MXN or JPY to US dollars at today's ECB rate. Use when the buyer names a non-market currency. Read-only.",
  kind: "read",
  input: z.object({ amount: decimalAmount(), currency: z.enum(SUPPORTED_CURRENCIES) }),
  async run(_ctx, input) {
    const fx = await frankfurter.getRate(input.currency, "USD");
    const minor = parseDecimal(input.amount, input.currency);
    return {
      original: money(minor, input.currency),
      usd: money(convertMinor(minor, input.currency, "USD", fx.rate), "USD"),
      rate: fx.rate,
      rate_date: fx.date,
      source: fx.source,
    };
  },
});

const searchProductsTool = defineTool({
  name: "search_products",
  description:
    "Search products in the buyer's market (multilingual). Returns the NEAREST matches, possibly unrelated: judge relevance. Each has listing_id, title, summary, price, price_usd, seller. Read-only.",
  kind: "read",
  input: z.object({
    query: z.string().min(1).max(300),
    limit: z.number().int().min(1).max(10).nullable().describe("How many results (default 6)."),
  }),
  run: (ctx, input) =>
    searchListings(ctx.locale, input.query, input.limit ?? 5)
      .then(withUsd)
      // Keep tool output small: it is re-sent to the model on every step.
      .then((rs) => ({ results: rs.map(({ relevance: _r, summary, ...rest }) => ({ ...rest, summary: summary.length > 90 ? `${summary.slice(0, 87)}...` : summary })) })),
});

const compareProductsTool = defineTool({
  name: "compare_products",
  description:
    "Get the full facts (description, price, seller, ships-from country, attributes) for 2 to 4 listings so you can compare them. Compare only on these facts. Attributes may be in the seller's language; translate them when you present them. Read-only.",
  kind: "read",
  input: z.object({ listing_ids: z.array(uuid()).min(2).max(4) }),
  run: async (ctx, input) => ({ listings: await withUsd(await publishedListingFacts(ctx.locale, input.listing_ids)) }),
});

const addToCartTool = defineTool({
  name: "add_to_cart",
  description: `Add a listing to the buyer's cart (adds to any quantity already there; max ${MAX_QUANTITY} per item). Call it only when the buyer asked for or confirmed this item and quantity. Returns the whole cart with totals. Never starts checkout.`,
  kind: "draft",
  input: z.object({ listing_id: uuid(), quantity: z.number().int().min(1).max(MAX_QUANTITY) }),
  run: (ctx, input) => addToCart(buyerOf(ctx), ctx.locale, input.listing_id, input.quantity),
});

const updateCartTool = defineTool({
  name: "update_cart",
  description: "Set the quantity of an item already in the cart; 0 removes it. Call it only when the buyer asks to change or remove an item. Returns the whole cart.",
  kind: "draft",
  input: z.object({ listing_id: uuid(), quantity: z.number().int().min(0).max(MAX_QUANTITY) }),
  run: (ctx, input) => updateCart(buyerOf(ctx), input.listing_id, input.quantity),
});

const viewCartTool = defineTool({
  name: "view_cart",
  description: "Show the buyer's carts. Each cart is one seller and one currency, with items, totals and a cart_id. Read-only.",
  kind: "read",
  input: z.object({}),
  run: (ctx) => viewCart(buyerOf(ctx)),
});

const createPaypalOrderTool = defineTool({
  name: "create_paypal_order",
  description:
    "Start PayPal checkout for one cart (by cart_id from view_cart or add_to_cart). Call it only when the buyer says they want to pay. Returns the PayPal order id, the approval link and the total. This does NOT charge the buyer: the buyer must approve the payment in the PayPal window, and the payment is captured only after that approval.",
  kind: "draft",
  input: z.object({ cart_id: uuid() }),
  async run(ctx, input) {
    const res = await startCheckout(buyerOf(ctx), input.cart_id, ctx.audit);
    return {
      ...res,
      charged: false,
      next_step: "The buyer must open the PayPal window (the PayPal button below the chat, or approve_url) and approve the payment.",
    };
  },
});

export const SHOPPING_TOOLS = [getMyOrderTool, showInShopTool, convertToUsdTool, searchProductsTool, compareProductsTool, addToCartTool, updateCartTool, viewCartTool, createPaypalOrderTool];
