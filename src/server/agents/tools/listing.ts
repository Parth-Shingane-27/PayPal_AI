import { z } from "zod";
import { frankfurter } from "../../clients/frankfurter";
import { prisma } from "../../db";
import { listMarkets, MARKET_LOCALES } from "../../domain/markets";
import { SUPPORTED_CURRENCIES } from "../../domain/money";
import { AppError } from "../../errors";
import { productView, saveListingDraft, SEO_TITLE_MAX } from "../../services/catalog";
import { type PriceQuote, quotePrice } from "../../services/pricing";
import { defineTool } from "../tool";
import { decimalAmount, sellerOf, uuid } from "./common";

export const getProductTool = defineTool({
  name: "get_product",
  description:
    "Read one of the seller's products: source title and description, cost, shipping, target margin, attributes, and its existing listings per market. Call it first, before localizing or pricing a product. Returns facts only; it never changes anything.",
  kind: "read",
  input: z.object({ product_id: uuid().describe("The product's id.") }),
  run: (ctx, input) => productView(sellerOf(ctx), input.product_id),
});

const listMarketsTool = defineTool({
  name: "list_markets",
  description:
    "List the markets GlobalCart sells into: locale, country, currency, listing language, units (metric/imperial) and price rounding. Call it when you need to know which markets exist or how a market works. Read-only.",
  kind: "read",
  input: z.object({}),
  run: async () => ({
    markets: listMarkets(),
    note: "hi-IN listings are priced in USD because PayPal only accepts INR for accounts registered in India.",
  }),
});

const getFxRateTool = defineTool({
  name: "get_fx_rate",
  description:
    "Get today's ECB reference exchange rate (1 `from` = rate `to`) from Frankfurter. Call it to show a seller what their cost is worth in a market currency. suggest_price already converts costs itself, so you do not need this before pricing. Returns the rate and its date; never converts amounts for you.",
  kind: "read",
  input: z.object({ from: z.enum(SUPPORTED_CURRENCIES), to: z.enum(SUPPORTED_CURRENCIES) }),
  run: (_ctx, input) => frankfurter.getRate(input.from, input.to),
});

const suggestPriceTool = defineTool({
  name: "suggest_price",
  description:
    "Compute the local price for a product in one market: converts cost plus shipping at today's rate, applies estimated PayPal, international, conversion and platform fees, meets the product's target margin, and rounds up to a natural price point. Pass the competitor range only if the seller gave one (both ends, in the market currency), and target_price only if the seller asked to evaluate a specific price. Returns a quote with quote_id, suggested_price, profit, margin, fee breakdown and warnings, each amount with a `display` string. Call it once per market before save_listing_draft. It never saves anything.",
  kind: "read",
  input: z.object({
    product_id: uuid(),
    market: z.enum(MARKET_LOCALES).describe("Market locale, e.g. de-DE."),
    competitor_low: decimalAmount().nullable().describe("Low end of the seller's competitor range in the market currency, or null."),
    competitor_high: decimalAmount().nullable().describe("High end of the competitor range, or null."),
    target_price: decimalAmount().nullable().describe("A specific price the seller wants evaluated, or null for a suggestion."),
  }),
  async run(ctx, input) {
    const quote = await quotePrice(sellerOf(ctx), {
      productId: input.product_id,
      locale: input.market,
      competitorLow: input.competitor_low ?? undefined,
      competitorHigh: input.competitor_high ?? undefined,
      targetPrice: input.target_price ?? undefined,
    });
    return { quote_id: ctx.actionId, ...quote };
  },
});

const saveListingDraftTool = defineTool({
  name: "save_listing_draft",
  description: `Save (or replace) the DRAFT listing for the product and market of a price quote, using the quote's suggested price exactly. Pass the quote_id from suggest_price plus the title, description and seo_title you wrote natively in the market's language (seo_title at most ${SEO_TITLE_MAX} characters). Saving over a published listing moves it back to DRAFT. Returns the saved draft. It never publishes: publishing is the seller's click in the listing editor.`,
  kind: "draft",
  input: z.object({
    quote_id: uuid().describe("quote_id returned by suggest_price in this conversation."),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(5000),
    seo_title: z.string().min(1).describe(`Search title, at most ${SEO_TITLE_MAX} characters.`),
  }),
  async run(ctx, input) {
    const sellerId = sellerOf(ctx);
    const quoteRow = await prisma.agentAction.findFirst({
      where: { id: input.quote_id, tool: "suggest_price", status: "SUCCEEDED", seller_id: sellerId },
    });
    if (!quoteRow?.output) throw new AppError("NOT_FOUND", "Quote not found. Call suggest_price for this market first and use its quote_id.");
    const quote = quoteRow.output as unknown as PriceQuote & { quote_id: string };
    const listing = await saveListingDraft(sellerId, {
      productId: quote.product_id,
      locale: quote.locale,
      title: input.title,
      description: input.description,
      seoTitle: input.seo_title,
      priceMinor: quote.suggested_price.amount_minor,
      pricing: quote,
    });
    return {
      listing_id: listing.id,
      product_id: listing.product_id,
      market: listing.locale,
      status: listing.status,
      price: quote.suggested_price,
      profit: quote.profit,
      margin_percent: quote.margin_percent,
      warnings: quote.warnings,
      seo_title_length: [...listing.seo_title].length,
      message: "Saved as DRAFT. The seller publishes it from the listing editor.",
    };
  },
});

export const LISTING_TOOLS = [getProductTool, listMarketsTool, getFxRateTool, suggestPriceTool, saveListingDraftTool];
