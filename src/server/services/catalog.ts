import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { type Db, prisma } from "../db";
import { getMarket, isMarketLocale, MARKET_LOCALES } from "../domain/markets";
import { money, parseDecimal, parsePercentToBps, SUPPORTED_CURRENCIES } from "../domain/money";
import { AppError, notFound } from "../errors";
import { enqueueEmbedding } from "../queue";
import { asJson } from "./audit";

/** Every query filters by seller_id, so another seller's id reads as "not found". */

export const SEO_TITLE_MAX = 70;

const productInputSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  source_locale: z.enum(MARKET_LOCALES),
  cost_minor: z.number().int().min(0),
  cost_currency: z.enum(SUPPORTED_CURRENCIES),
  shipping_minor: z.number().int().min(0),
  margin_bps: z.number().int().min(0).max(9000),
  attributes: z.record(z.string(), z.unknown()).default({}),
  image_url: z.url().nullish(),
});
type ProductInput = z.infer<typeof productInputSchema>;

/** The product form: money and margin as the seller typed them, converted here. */
export const productFormSchema = z.object({
  sku: z.string(),
  title: z.string(),
  description: z.string(),
  source_locale: z.enum(MARKET_LOCALES),
  cost: z.string(),
  shipping: z.string(),
  cost_currency: z.enum(SUPPORTED_CURRENCIES),
  margin_percent: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export function productFromForm(form: z.infer<typeof productFormSchema>): ProductInput {
  return {
    sku: form.sku,
    title: form.title,
    description: form.description,
    source_locale: form.source_locale,
    cost_minor: parseDecimal(form.cost, form.cost_currency),
    shipping_minor: parseDecimal(form.shipping || "0", form.cost_currency),
    cost_currency: form.cost_currency,
    margin_bps: parsePercentToBps(form.margin_percent),
    attributes: form.attributes,
  };
}

export async function createProduct(sellerId: string, input: ProductInput) {
  const data = productInputSchema.parse(input);
  const existing = await prisma.product.findUnique({ where: { seller_id_sku: { seller_id: sellerId, sku: data.sku } } });
  if (existing) throw new AppError("CONFLICT", `You already have a product with SKU ${data.sku}.`);
  return prisma.product.create({
    data: { ...data, attributes: asJson(data.attributes), image_url: data.image_url ?? null, seller_id: sellerId },
  });
}

export async function listProducts(sellerId: string) {
  return prisma.product.findMany({
    where: { seller_id: sellerId },
    orderBy: { created_at: "desc" },
    include: { listings: { select: { id: true, locale: true, status: true, price_minor: true, currency: true } } },
  });
}

export async function getProduct(sellerId: string, productId: string, db: Db = prisma) {
  const product = await db.product.findFirst({
    where: { id: productId, seller_id: sellerId },
    include: { listings: { orderBy: { locale: "asc" } } },
  });
  if (!product) throw notFound("Product");
  return product;
}

/** Tool view of a product: facts plus listing summaries, money with display text. */
export async function productView(sellerId: string, productId: string) {
  const p = await getProduct(sellerId, productId);
  return {
    product_id: p.id,
    sku: p.sku,
    title: p.title,
    description: p.description,
    source_locale: p.source_locale,
    cost: money(p.cost_minor, p.cost_currency),
    shipping: money(p.shipping_minor, p.cost_currency),
    target_margin_percent: p.margin_bps / 100,
    attributes: p.attributes,
    listings: p.listings.map((l) => ({
      listing_id: l.id,
      locale: l.locale,
      status: l.status,
      title: l.title,
      price: money(l.price_minor, l.currency, l.locale),
    })),
  };
}

type ListingDraft = {
  productId: string;
  locale: string;
  title: string;
  description: string;
  seoTitle: string;
  priceMinor: number;
  pricing: unknown | null;
};

function validateListingText(d: Pick<ListingDraft, "title" | "description" | "seoTitle">) {
  if (!d.title.trim()) throw new AppError("INVALID_INPUT", "Title must not be empty.");
  if (!d.description.trim()) throw new AppError("INVALID_INPUT", "Description must not be empty.");
  if (!d.seoTitle.trim()) throw new AppError("INVALID_INPUT", "SEO title must not be empty.");
  if ([...d.seoTitle].length > SEO_TITLE_MAX) {
    throw new AppError("INVALID_INPUT", `SEO title is ${[...d.seoTitle].length} characters; the limit is ${SEO_TITLE_MAX}.`);
  }
}

/**
 * Creates or replaces the draft for (product, locale). Saving over a published
 * listing moves it back to DRAFT: the seller must publish again.
 */
export async function saveListingDraft(sellerId: string, d: ListingDraft, db: Db = prisma) {
  if (!isMarketLocale(d.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${d.locale}.`);
  validateListingText(d);
  if (!Number.isSafeInteger(d.priceMinor) || d.priceMinor <= 0) throw new AppError("INVALID_INPUT", "Price must be positive.");
  await getProduct(sellerId, d.productId, db);
  const market = getMarket(d.locale);
  const fields = {
    title: d.title.trim(),
    description: d.description.trim(),
    seo_title: d.seoTitle.trim(),
    price_minor: d.priceMinor,
    currency: market.currency,
    pricing: d.pricing === null ? undefined : asJson(d.pricing),
    status: "DRAFT" as const,
  };
  return db.listing.upsert({
    where: { product_id_locale: { product_id: d.productId, locale: d.locale } },
    create: { ...fields, product_id: d.productId, seller_id: sellerId, locale: d.locale },
    update: fields,
  });
}

export const listingEditSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  seo_title: z.string().trim().min(1),
  /** Decimal string in the listing's currency, e.g. "49.99". */
  price: z.string(),
});

/** Hand edit from the listing editor. A manual price clears the stored quote. */
export async function editListing(sellerId: string, listingId: string, edit: z.infer<typeof listingEditSchema>) {
  const listing = await prisma.listing.findFirst({ where: { id: listingId, seller_id: sellerId } });
  if (!listing) throw notFound("Listing");
  const data = listingEditSchema.parse(edit);
  validateListingText({ title: data.title, description: data.description, seoTitle: data.seo_title });
  const priceMinor = parseDecimal(data.price, listing.currency);
  if (priceMinor <= 0) throw new AppError("INVALID_INPUT", "Price must be positive.");
  return prisma.listing.update({
    where: { id: listing.id },
    data: {
      title: data.title,
      description: data.description,
      seo_title: data.seo_title,
      price_minor: priceMinor,
      status: "DRAFT",
      pricing: priceMinor === listing.price_minor ? undefined : Prisma.DbNull,
    },
  });
}

/**
 * Changes only a listing's price, keeping its text, and stores the quote it
 * came from. The listing goes back to DRAFT: the seller publishes again.
 */
export async function setListingPrice(sellerId: string, productId: string, locale: string, priceMinor: number, pricing: unknown) {
  const existing = await prisma.listing.findFirst({ where: { seller_id: sellerId, product_id: productId, locale } });
  if (!existing) throw new AppError("NOT_FOUND", `There is no listing in ${locale} yet. Write one first.`);
  const listing = await saveListingDraft(sellerId, {
    productId,
    locale,
    title: existing.title,
    description: existing.description,
    seoTitle: existing.seo_title,
    priceMinor,
    pricing,
  });
  return { before: existing, listing };
}

/** The seller's approval click: DRAFT -> PUBLISHED, then (re-)embed for search. */
export async function publishListing(sellerId: string, listingId: string) {
  const listing = await prisma.listing.findFirst({ where: { id: listingId, seller_id: sellerId } });
  if (!listing) throw notFound("Listing");
  if (listing.status === "PUBLISHED") return listing;
  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: { status: "PUBLISHED", published_at: new Date() },
  });
  await enqueueEmbedding(updated.id);
  return updated;
}

export async function unpublishListing(sellerId: string, listingId: string) {
  const listing = await prisma.listing.findFirst({ where: { id: listingId, seller_id: sellerId } });
  if (!listing) throw notFound("Listing");
  return prisma.listing.update({ where: { id: listing.id }, data: { status: "ARCHIVED" } });
}
