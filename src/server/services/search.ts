import { type EmbeddingApi, voyage } from "../clients/voyage";
import { prisma } from "../db";
import { money } from "../domain/money";
import { AppError } from "../errors";

/**
 * Semantic product search with pgvector. Exact cosine distance (no index), so
 * results are deterministic and the schema has no migration drift.
 */

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Text that represents a listing for retrieval. */
function embeddingText(l: { title: string; seo_title: string; description: string }, attributes: unknown): string {
  const facts =
    attributes && typeof attributes === "object" && !Array.isArray(attributes)
      ? Object.entries(attributes as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
          .join("\n")
      : "";
  return [l.title, l.seo_title, l.description, facts].filter(Boolean).join("\n");
}

/**
 * Worker job: embeds a published listing as a "document". Skips listings that
 * were unpublished, and refuses to store a vector for text that changed while
 * the request was in flight (the next publish queues a fresh job).
 */
export async function embedListing(listingId: string, client: EmbeddingApi = voyage): Promise<"EMBEDDED" | "SKIPPED"> {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, include: { product: true } });
  if (!listing || listing.status !== "PUBLISHED") return "SKIPPED";
  const [vec] = await client.embed([embeddingText(listing, listing.product.attributes)], "document");
  if (!vec) throw new Error("No embedding returned");
  const updated = await prisma.$executeRaw`
    UPDATE listings SET embedding = ${vectorLiteral(vec)}::vector, embedded_at = now()
    WHERE id = ${listing.id}::uuid AND updated_at = ${listing.updated_at} AND status = 'PUBLISHED'`;
  return updated === 1 ? "EMBEDDED" : "SKIPPED";
}

type SearchRow = {
  id: string;
  title: string;
  description: string;
  price_minor: number;
  currency: string;
  seller_name: string;
  similarity: number;
};

/** Search PUBLISHED listings in one market only. */
export async function searchListings(locale: string, query: string, limit = 6, client: EmbeddingApi = voyage) {
  const q = query.trim();
  if (!q) throw new AppError("INVALID_INPUT", "Search query must not be empty.");
  const [vec] = await client.embed([q], "query");
  if (!vec) throw new Error("No embedding returned");
  const take = Math.max(1, Math.min(limit, 20));
  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT l.id, l.title, l.description, l.price_minor, l.currency, s.name AS seller_name,
           1 - (l.embedding <=> ${vectorLiteral(vec)}::vector) AS similarity
    FROM listings l
    JOIN sellers s ON s.id = l.seller_id
    WHERE l.status = 'PUBLISHED' AND l.locale = ${locale} AND l.embedding IS NOT NULL
    ORDER BY l.embedding <=> ${vectorLiteral(vec)}::vector
    LIMIT ${take}`;
  return rows.map((r) => ({
    listing_id: r.id,
    title: r.title,
    summary: r.description.length > 240 ? `${r.description.slice(0, 237)}...` : r.description,
    price: money(r.price_minor, r.currency, locale),
    seller: r.seller_name,
    relevance: Math.round(Number(r.similarity) * 1000) / 1000,
  }));
}

/**
 * Every published listing in one market, for the shop's browse list. Needs no
 * embedding, so new listings show up before the worker has indexed them.
 */
export async function listPublishedListings(locale: string) {
  const listings = await prisma.listing.findMany({
    where: { locale, status: "PUBLISHED" },
    include: { seller: true, product: { select: { id: true, image_url: true, category: true, rating_avg: true, rating_count: true } } },
    orderBy: { title: "asc" },
  });
  return listings.map((l) => ({
    listing_id: l.id,
    product_id: l.product.id,
    title: l.title,
    summary: l.description.length > 160 ? `${l.description.slice(0, 157)}...` : l.description,
    price: money(l.price_minor, l.currency, locale),
    seller: l.seller.name,
    seller_country: l.seller.country,
    image_url: l.product.image_url,
    category: l.product.category,
    rating: l.product.rating_avg,
    rating_count: l.product.rating_count,
  }));
}

/** Full facts for listings a buyer can see (published, in their market). */
export async function publishedListingFacts(locale: string, listingIds: string[]) {
  const listings = await prisma.listing.findMany({
    where: { id: { in: listingIds }, locale, status: "PUBLISHED" },
    include: { product: true, seller: true },
  });
  const found = new Map(listings.map((l) => [l.id, l]));
  const missing = listingIds.filter((id) => !found.has(id));
  if (missing.length) throw new AppError("NOT_FOUND", `Listing not found in this market: ${missing.join(", ")}.`);
  return listingIds.map((id) => {
    const l = found.get(id)!;
    return {
      listing_id: l.id,
      title: l.title,
      description: l.description,
      price: money(l.price_minor, l.currency, locale),
      price_includes_shipping: true,
      seller: { name: l.seller.name, ships_from: l.seller.country },
      sku: l.product.sku,
      attributes: l.product.attributes,
      attributes_language: l.product.source_locale,
    };
  });
}

/** Published listings with no vector yet (e.g. embedded before a Voyage key was set). */
export async function listingsMissingEmbeddings(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM listings WHERE status = 'PUBLISHED' AND embedding IS NULL`;
  return rows.map((r) => r.id);
}
