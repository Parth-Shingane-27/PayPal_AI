import { z } from "zod";
import { frankfurter } from "../../clients/frankfurter";
import { prisma } from "../../db";
import { listMarkets, MARKET_LOCALES } from "../../domain/markets";
import { money, SUPPORTED_CURRENCIES } from "../../domain/money";
import { AppError } from "../../errors";
import { createProduct, productFromForm, productView, saveListingDraft, SEO_TITLE_MAX, setListingPrice } from "../../services/catalog";
import {
  linkDraftResearch,
  pricingAtPositions,
  productMarketOverview,
  researchDraftPrices,
  researchMarketPrices,
  type ResearchOutcome,
} from "../../services/market-research";
import { type PriceQuote, quotePrice } from "../../services/pricing";
import { defineTool } from "../tool";
import { decimalAmount, sellerOf, uuid } from "../shared-tools";

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
    "Compute the local price for a product in one market: converts cost plus shipping at today's rate, applies estimated PayPal, international, conversion and platform fees, meets the product's target margin, and rounds up to a natural price point. With positioning (competitive = lower quartile, market = median, premium = upper quartile of the prices found by research_market_prices) it aims at that market price, but never below the margin floor. Pass the competitor range only if the seller gave one (both ends, in the market currency), and target_price only if the seller asked to evaluate a specific price; either overrides positioning. Returns a quote with quote_id, suggested_price, margin_floor_price, profit, margin, fee breakdown, market (range, where the price sits, cheaper_offers_percent) and warnings, each amount with a `display` string. Call it once per market before save_listing_draft or reprice_listing. It never saves anything.",
  kind: "read",
  input: z.object({
    product_id: uuid(),
    market: z.enum(MARKET_LOCALES).describe("Market locale, e.g. de-DE."),
    competitor_low: decimalAmount().nullable().describe("Low end of the seller's competitor range in the market currency, or null."),
    competitor_high: decimalAmount().nullable().describe("High end of the competitor range, or null."),
    target_price: decimalAmount().nullable().describe("A specific price the seller wants evaluated, or null for a suggestion."),
    positioning: z
      .enum(["competitive", "market", "premium"])
      .nullable()
      .describe("Aim at the researched market price: competitive (lower quartile), market (median) or premium (upper quartile). Null prices from cost and margin only."),
  }),
  async run(ctx, input) {
    const quote = await quotePrice(sellerOf(ctx), {
      productId: input.product_id,
      locale: input.market,
      competitorLow: input.competitor_low ?? undefined,
      competitorHigh: input.competitor_high ?? undefined,
      targetPrice: input.target_price ?? undefined,
      positioning: input.positioning ?? undefined,
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
      market_position: quote.market ? { position: quote.market.position, range: quote.market.range } : null,
      warnings: quote.warnings,
      seo_title_length: [...listing.seo_title].length,
      message: "Saved as DRAFT. The seller publishes it from the listing editor.",
    };
  },
});

const researchMarketPricesTool = defineTool({
  name: "research_market_prices",
  description:
    "Find what comparable products sell for in each market: searches that country's online shops (in its language) and other sellers on GlobalCart. Code validates every offer (its URL must come from the search, used items are dropped), divides pack prices into unit prices, converts them into the market currency at today's ECB rate, drops outliers and computes the range. Returns per market: range (low, p25, median, p75, high), the offers with shop, title, unit_price, listed_price, url and whether the price was confirmed on the page, the seller's current listing price, and notes. Research from the last 24 hours is reused unless refresh is true. For a product being added, pass preview_id: the result also gives at_your_costs (the price the seller's cost and target margin lead to, and the margin they would make at the market's lower quartile, median and upper quartile), and the research carries over when the product is created. Takes about 10-20 seconds per market. Call it before pricing a market so suggest_price can use positioning. Read-only; it changes no listing.",
  kind: "read",
  input: z.object({
    product_id: uuid().nullable().describe("A saved product's id, or null when researching a product being added (pass preview_id instead)."),
    preview_id: uuid()
      .nullable()
      .describe("preview_id from preview_product in this conversation, to research a product before it is created; null for a saved product."),
    markets: z.array(z.enum(MARKET_LOCALES)).min(1).max(6).describe("Market locales to research, at most 6 per call."),
    refresh: z.boolean().nullable().describe("true to search again even if research from the last 24 hours exists; null or false to reuse it."),
  }),
  async run(ctx, input) {
    const sellerId = sellerOf(ctx);
    if ((input.product_id === null) === (input.preview_id === null)) {
      throw new AppError("INVALID_INPUT", "Pass either product_id (a saved product) or preview_id (a product being added), not both.");
    }
    let results: (ResearchOutcome & { pricing?: Awaited<ReturnType<typeof pricingAtPositions>> })[];
    if (input.preview_id) {
      const preview = await prisma.agentAction.findFirst({
        where: { id: input.preview_id, tool: "preview_product", status: "SUCCEEDED", seller_id: sellerId, session_id: ctx.sessionId },
      });
      if (!preview?.output) throw new AppError("NOT_FOUND", "Preview not found. Call preview_product first and use its preview_id.");
      const p = productFromForm((preview.output as { form: ProductForm }).form);
      results = await researchDraftPrices(sellerId, p, input.markets, { refresh: input.refresh ?? false });
    } else {
      results = await researchMarketPrices(sellerId, input.product_id!, input.markets, { refresh: input.refresh ?? false });
    }
    return {
      markets: results.map((r) => {
        if ("error" in r) return { market: r.market, error: r.error };
        const x = r.result;
        const pricing = r.pricing ?? null;
        return {
          market: r.market,
          currency: x.currency,
          researched_at: x.researched_at,
          reused_earlier_research: r.cached,
          comparable_prices_found: x.stats?.count ?? 0,
          range: x.range,
          your_listing: x.your_listing,
          offers: x.offers.slice(0, 10).map((o) => ({
            source: o.source,
            shop: o.shop,
            title: o.title,
            unit_price: o.unit_price,
            listed_price: o.listed_price,
            match: o.match,
            price_confirmed_on_page: o.price_on_page,
            url: o.url,
          })),
          web_search: x.web.status === "failed" ? { status: "failed", error: x.web.error } : { status: x.web.status },
          ...(pricing
            ? {
                at_your_costs: {
                  price_at_target_margin: pricing.cost_based_price,
                  target_margin_percent: pricing.target_margin_percent,
                  margin_if_priced_at_market: pricing.margin_at_market,
                },
              }
            : {}),
          notes: [...x.notes, ...(x.globalcart.note ? [x.globalcart.note] : [])],
        };
      }),
      note: "Observed prices from public shop pages. Prices include whatever the shop includes (often VAT, sometimes not shipping); treat them as a guide.",
    };
  },
});

const marketOverviewTool = defineTool({
  name: "market_overview",
  description:
    "One product across every GlobalCart market: listing status and price per market, that price in the seller's home currency, units sold (90 days), views and add-to-carts (30 days), the latest researched market range and whether the price is above, inside or below it. Use it to answer where to sell next, why a market is not selling, or whether prices are consistent across markets. Read-only.",
  kind: "read",
  input: z.object({ product_id: uuid() }),
  run: (ctx, input) => productMarketOverview(sellerOf(ctx), input.product_id),
});

const repriceListingTool = defineTool({
  name: "reprice_listing",
  description:
    "Change only the price of the product's existing listing in a market to a suggest_price quote's suggested_price, keeping its title and description. Pass the quote_id. The listing goes back to DRAFT so the seller reviews and publishes it again. Use it when the seller wants a new price without rewriting the listing. Returns the old and new price.",
  kind: "draft",
  input: z.object({ quote_id: uuid().describe("quote_id returned by suggest_price in this conversation.") }),
  async run(ctx, input) {
    const sellerId = sellerOf(ctx);
    const quoteRow = await prisma.agentAction.findFirst({
      where: { id: input.quote_id, tool: "suggest_price", status: "SUCCEEDED", seller_id: sellerId },
    });
    if (!quoteRow?.output) throw new AppError("NOT_FOUND", "Quote not found. Call suggest_price for this market first and use its quote_id.");
    const quote = quoteRow.output as unknown as PriceQuote & { quote_id: string };
    const { before: existing, listing } = await setListingPrice(sellerId, quote.product_id, quote.locale, quote.suggested_price.amount_minor, quote);
    return {
      listing_id: listing.id,
      market: listing.locale,
      status: listing.status,
      old_price: money(existing.price_minor, existing.currency, existing.locale),
      new_price: quote.suggested_price,
      profit: quote.profit,
      margin_percent: quote.margin_percent,
      warnings: quote.warnings,
      message: "Price changed and saved as DRAFT. The seller publishes it again from the listing editor.",
    };
  },
});

/** A SKU from the title's first words, e.g. "Hand-thrown stoneware mug" → "HAND-THROWN-STONEWARE". */
function skuFromTitle(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("-")
    .toUpperCase()
    .slice(0, 40);
  return base || "PRODUCT";
}

async function uniqueSku(sellerId: string, wanted: string): Promise<string> {
  const taken = new Set(
    (await prisma.product.findMany({ where: { seller_id: sellerId, sku: { startsWith: wanted } }, select: { sku: true } })).map((p) => p.sku),
  );
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted}-${n}`)) return `${wanted}-${n}`;
}

type ProductForm = Parameters<typeof productFromForm>[0];

const previewProductTool = defineTool({
  name: "preview_product",
  description:
    "Check a new product built from facts the seller gave you, before creating it. Never guess cost or shipping: ask for them first. Returns a preview_id and the summary to show the seller (title, description, SKU, cost, shipping, margin, material, size, each amount with a `display` string). It creates nothing. Show the summary, ask the seller to confirm, and end your reply; create_product with this preview_id works only after the seller has replied.",
  kind: "read",
  input: z.object({
    title: z.string().min(1).max(200).describe("Product name in the language the seller wrote it in."),
    description: z.string().min(1).max(5000).describe("What it is, how it is made, size and care, using only facts the seller gave."),
    written_in: z.enum(MARKET_LOCALES).nullable().describe("Market locale whose language the title and description are in, or null for the seller's own market."),
    cost: decimalAmount().describe("What one unit costs the seller to make or buy, as the seller stated it."),
    shipping: decimalAmount().nullable().describe("Shipping cost per unit as the seller stated it, or null if the seller said shipping is free or included."),
    cost_currency: z.enum(SUPPORTED_CURRENCIES).describe("Currency of cost and shipping, as the seller stated it."),
    margin_percent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable().describe("Target profit margin in percent, e.g. 35, or null for the default of 30."),
    sku: z.string().min(1).max(64).nullable().describe("The seller's stock code, or null to generate one from the title."),
    material: z.string().max(200).nullable().describe("Main material if the seller said it, else null."),
    size: z.string().max(200).nullable().describe("Size or capacity if the seller said it, else null."),
  }),
  async run(ctx, input) {
    const sellerId = sellerOf(ctx);
    const sku = input.sku ? input.sku.trim().toUpperCase() : await uniqueSku(sellerId, skuFromTitle(input.title));
    if (input.sku && (await prisma.product.findUnique({ where: { seller_id_sku: { seller_id: sellerId, sku } } }))) {
      throw new AppError("CONFLICT", `The seller already has a product with SKU ${sku}. Ask for another SKU or pass null to generate one.`);
    }
    const attributes: Record<string, string> = {};
    if (input.material?.trim()) attributes.material = input.material.trim();
    if (input.size?.trim()) attributes.size = input.size.trim();
    const form: ProductForm = {
      sku,
      title: input.title.trim(),
      description: input.description.trim(),
      source_locale: input.written_in ?? ctx.market.locale,
      cost: input.cost,
      shipping: input.shipping ?? "0",
      cost_currency: input.cost_currency,
      margin_percent: input.margin_percent ?? "30",
      attributes,
    };
    const p = productFromForm(form); // validates amounts and margin now, so the summary is what gets created
    return {
      preview_id: ctx.actionId,
      form,
      summary: {
        title: p.title,
        description: p.description,
        sku: p.sku,
        sku_generated: !input.sku,
        written_in: p.source_locale,
        cost: money(p.cost_minor, p.cost_currency, ctx.market.locale),
        shipping: money(p.shipping_minor, p.cost_currency, ctx.market.locale),
        margin_percent: p.margin_bps / 100,
        margin_is_default: !input.margin_percent,
        ...attributes,
      },
      message: "Nothing is created yet. Show this summary, ask the seller to confirm, and wait for their reply before calling create_product.",
    };
  },
});

const createProductTool = defineTool({
  name: "create_product",
  description:
    "Create the product exactly as previewed by preview_product, after the seller confirmed the summary in a later message. Pass the preview_id. It fails if the seller has not replied since the preview; if they asked for changes, call preview_product again and ask again. Returns the new product_id for suggest_price and save_listing_draft. It creates no listings and publishes nothing.",
  kind: "draft",
  input: z.object({ preview_id: uuid().describe("preview_id from preview_product in this conversation.") }),
  async run(ctx, input) {
    const sellerId = sellerOf(ctx);
    const [preview, session] = await Promise.all([
      prisma.agentAction.findFirst({
        where: { id: input.preview_id, tool: "preview_product", status: "SUCCEEDED", seller_id: sellerId, session_id: ctx.sessionId },
      }),
      prisma.agentSession.findUnique({ where: { id: ctx.sessionId }, select: { run_started_at: true } }),
    ]);
    if (!preview?.output) throw new AppError("NOT_FOUND", "Preview not found. Call preview_product first and use its preview_id.");
    // The seller must have sent a message after seeing the preview: it has to predate this run.
    if (!session?.run_started_at || preview.created_at >= session.run_started_at) {
      throw new AppError("INVALID_INPUT", "The seller has not confirmed this preview yet. Show them the summary, ask them to confirm, and end your reply.");
    }
    const { form } = preview.output as { form: ProductForm };
    const product = await createProduct(sellerId, productFromForm(form));
    await linkDraftResearch(sellerId, product.id, product.title, product.description);
    return {
      product_id: product.id,
      sku: product.sku,
      title: product.title,
      message: "Product created with no listings yet. Ask which markets to list it in, then price and draft each one.",
    };
  },
});

export const LISTING_TOOLS = [
  getProductTool,
  previewProductTool,
  createProductTool,
  listMarketsTool,
  marketOverviewTool,
  researchMarketPricesTool,
  getFxRateTool,
  suggestPriceTool,
  saveListingDraftTool,
  repriceListingTool,
];
