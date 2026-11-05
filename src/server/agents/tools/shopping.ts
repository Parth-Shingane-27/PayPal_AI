import { z } from "zod";
import { addToCart, MAX_QUANTITY, updateCart, viewCart } from "../../services/cart";
import { startCheckout } from "../../services/checkout";
import { publishedListingFacts, searchListings } from "../../services/search";
import { defineTool } from "../tool";
import { buyerOf, uuid } from "./common";

const searchProductsTool = defineTool({
  name: "search_products",
  description:
    "Semantic search over products published in the buyer's market. Use the buyer's own words, or a short English paraphrase when that helps (search is multilingual). Returns up to `limit` matches with listing_id, title, summary, price (with `display`), seller and relevance. Read-only; results only include listings the buyer can buy.",
  kind: "read",
  input: z.object({
    query: z.string().min(1).max(300),
    limit: z.number().int().min(1).max(10).nullable().describe("How many results (default 6)."),
  }),
  run: (ctx, input) => searchListings(ctx.locale, input.query, input.limit ?? 6).then((results) => ({ results })),
});

const compareProductsTool = defineTool({
  name: "compare_products",
  description:
    "Get the full facts (description, price, seller, ships-from country, attributes) for 2 to 4 listings so you can compare them. Compare only on these facts. Attributes may be in the seller's language; translate them when you present them. Read-only.",
  kind: "read",
  input: z.object({ listing_ids: z.array(uuid()).min(2).max(4) }),
  run: async (ctx, input) => ({ listings: await publishedListingFacts(ctx.locale, input.listing_ids) }),
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

export const SHOPPING_TOOLS = [searchProductsTool, compareProductsTool, addToCartTool, updateCartTool, viewCartTool, createPaypalOrderTool];
