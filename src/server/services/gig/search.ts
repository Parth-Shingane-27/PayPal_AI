import { type EmbeddingApi, voyage } from "../../clients/voyage";
import { ConfigError } from "../../config";
import { prisma } from "../../db";
import { isMarketLocale } from "../../domain/markets";
import { money } from "../../domain/money";
import { AppError } from "../../errors";

/**
 * Finding freelancers for a client: semantic search (pgvector, exact cosine
 * distance) over the published service pages in the client's market AND over
 * freelancers' skills profiles, merged per service page. When embeddings are
 * not available (no VOYAGE_API_KEY, or nothing indexed yet) it falls back to a
 * keyword match, and says so in `mode`.
 */

const vec = (v: number[]) => `[${v.join(",")}]`;

function pageText(p: { title: string; seo_title: string; description: string }, s: { category: string; tags: string[] }) {
  return [p.title, p.seo_title, p.description, `Category: ${s.category}`, s.tags.length ? `Tags: ${s.tags.join(", ")}` : ""].filter(Boolean).join("\n");
}

function freelancerText(f: { name: string; headline: string; bio: string; skills: string[]; languages: string[] }) {
  return [f.headline, f.bio, `Skills: ${f.skills.join(", ")}`, `Languages: ${f.languages.join(", ")}`].join("\n");
}

/** Worker job: embeds a published service page. Skips pages unpublished or edited meanwhile. */
export async function embedServicePage(pageId: string, client: EmbeddingApi = voyage): Promise<"EMBEDDED" | "SKIPPED"> {
  const page = await prisma.servicePage.findUnique({ where: { id: pageId }, include: { service: true } });
  if (!page || page.status !== "PUBLISHED") return "SKIPPED";
  const [v] = await client.embed([pageText(page, page.service)], "document");
  if (!v) throw new Error("No embedding returned");
  const n = await prisma.$executeRaw`
    UPDATE service_pages SET embedding = ${vec(v)}::vector, embedded_at = now()
    WHERE id = ${page.id}::uuid AND updated_at = ${page.updated_at} AND status = 'PUBLISHED'`;
  return n === 1 ? "EMBEDDED" : "SKIPPED";
}

/** Worker job: embeds a freelancer's skills profile. */
export async function embedFreelancer(freelancerId: string, client: EmbeddingApi = voyage): Promise<"EMBEDDED" | "SKIPPED"> {
  const f = await prisma.freelancer.findUnique({ where: { id: freelancerId } });
  if (!f) return "SKIPPED";
  const [v] = await client.embed([freelancerText(f)], "document");
  if (!v) throw new Error("No embedding returned");
  await prisma.$executeRaw`UPDATE freelancers SET embedding = ${vec(v)}::vector, embedded_at = now() WHERE id = ${f.id}::uuid`;
  return "EMBEDDED";
}

export async function gigEmbeddingsMissing(): Promise<{ kind: "service_page" | "freelancer"; id: string }[]> {
  const [pages, people] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`SELECT id FROM service_pages WHERE status = 'PUBLISHED' AND embedding IS NULL`,
    prisma.$queryRaw<{ id: string }[]>`SELECT id FROM freelancers WHERE embedding IS NULL`,
  ]);
  return [...pages.map((p) => ({ kind: "service_page" as const, id: p.id })), ...people.map((p) => ({ kind: "freelancer" as const, id: p.id }))];
}

type Hit = { page_id: string; score: number };

/** Keyword fallback: every query word that appears in the page or the freelancer's profile scores a point. */
async function keywordHits(locale: string, query: string, take: number): Promise<Hit[]> {
  const words = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}.+#]+/u).filter((w) => w.length >= 2))].slice(0, 12);
  const pages = await prisma.servicePage.findMany({
    where: { locale, status: "PUBLISHED" },
    select: { id: true, title: true, description: true, service: { select: { category: true, tags: true, title: true } }, freelancer: { select: { skills: true, headline: true } } },
  });
  const scored = pages
    .map((p) => {
      const hay = [p.title, p.description, p.service.title, p.service.category, ...p.service.tags, ...p.freelancer.skills, p.freelancer.headline].join(" ").toLowerCase();
      const score = words.filter((w) => hay.includes(w)).length;
      return { page_id: p.id, score: words.length ? score / words.length : 0 };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, take);
}

/** Semantic hits: page similarity, boosted by the freelancer's skills similarity. */
async function semanticHits(locale: string, query: string, take: number, client: EmbeddingApi): Promise<Hit[] | null> {
  let v: number[] | undefined;
  try {
    [v] = await client.embed([query], "query");
  } catch (err) {
    if (err instanceof ConfigError || (err instanceof AppError && err.code === "UPSTREAM_ERROR")) return null;
    throw err;
  }
  if (!v) return null;
  const rows = await prisma.$queryRaw<{ page_id: string; page_sim: number; skill_sim: number | null }[]>`
    SELECT p.id AS page_id,
           1 - (p.embedding <=> ${vec(v)}::vector) AS page_sim,
           CASE WHEN f.embedding IS NULL THEN NULL ELSE 1 - (f.embedding <=> ${vec(v)}::vector) END AS skill_sim
    FROM service_pages p JOIN freelancers f ON f.id = p.freelancer_id
    WHERE p.status = 'PUBLISHED' AND p.locale = ${locale} AND p.embedding IS NOT NULL
    ORDER BY p.embedding <=> ${vec(v)}::vector
    LIMIT ${take * 3}`;
  if (rows.length === 0) return null;
  return rows
    .map((r) => ({ page_id: r.page_id, score: 0.7 * Number(r.page_sim) + 0.3 * Number(r.skill_sim ?? r.page_sim) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}

/** search_freelancers: published services in the client's market, best match first. */
export async function searchFreelancers(locale: string, query: string, limit = 6, client: EmbeddingApi = voyage) {
  const q = query.trim();
  if (!q) throw new AppError("INVALID_INPUT", "Search query must not be empty.");
  if (!isMarketLocale(locale)) throw new AppError("INVALID_INPUT", `Unknown market ${locale}.`);
  const take = Math.max(1, Math.min(limit, 12));
  const semantic = await semanticHits(locale, q, take, client);
  const hits = semantic ?? (await keywordHits(locale, q, take));
  const pages = await prisma.servicePage.findMany({
    where: { id: { in: hits.map((h) => h.page_id) } },
    include: { prices: { include: { package: { select: { tier: true } } } }, service: true, freelancer: true },
  });
  const byId = new Map(pages.map((p) => [p.id, p]));
  return {
    mode: semantic ? ("semantic" as const) : ("keyword" as const),
    results: hits
      .map((h) => byId.get(h.page_id))
      .filter((p) => p !== undefined)
      .map((p, i) => {
        const from = p.prices.length ? Math.min(...p.prices.map((x) => x.price_minor)) : null;
        return {
          service_page_id: p.id,
          freelancer_id: p.freelancer_id,
          freelancer: p.freelancer.name,
          based_in: p.freelancer.country,
          headline: p.freelancer.headline,
          title: p.title,
          summary: p.description.length > 220 ? `${p.description.slice(0, 217)}...` : p.description,
          pricing: p.service.pricing_model,
          from_price: from === null ? null : money(from, p.currency, locale),
          hourly_rate: p.hourly_rate_minor === null ? null : money(p.hourly_rate_minor, p.currency, locale),
          rating: p.service.rating_avg,
          rating_count: p.service.rating_count,
          relevance: Math.round(hits[i]!.score * 1000) / 1000,
        };
      }),
  };
}

/** compare_freelancers: full facts for 2-4 service pages the client can buy in their market. */
export async function compareServicePages(locale: string, pageIds: string[]) {
  const pages = await prisma.servicePage.findMany({
    where: { id: { in: pageIds }, locale, status: "PUBLISHED" },
    include: { prices: true, service: { include: { packages: true } }, freelancer: true },
  });
  const found = new Map(pages.map((p) => [p.id, p]));
  const missing = pageIds.filter((id) => !found.has(id));
  if (missing.length) throw new AppError("NOT_FOUND", `Service not found in this market: ${missing.join(", ")}.`);
  const delivered = await prisma.milestone.groupBy({ by: ["freelancer_id"], where: { freelancer_id: { in: pages.map((p) => p.freelancer_id) }, state: "ACCEPTED" }, _count: true });
  const done = new Map(delivered.map((d) => [d.freelancer_id, d._count]));
  return pageIds.map((id) => {
    const p = found.get(id)!;
    const m = (minor: number) => money(minor, p.currency, locale);
    return {
      service_page_id: p.id,
      freelancer_id: p.freelancer_id,
      freelancer: {
        name: p.freelancer.name,
        based_in: p.freelancer.country,
        time_zone: p.freelancer.timezone,
        languages: p.freelancer.languages,
        skills: p.freelancer.skills,
        availability: p.freelancer.availability,
        milestones_delivered_and_accepted: done.get(p.freelancer_id) ?? 0,
      },
      title: p.title,
      description: p.description,
      rating: p.service.rating_avg,
      rating_count: p.service.rating_count,
      pricing: p.service.pricing_model,
      hourly_rate: p.hourly_rate_minor === null ? null : m(p.hourly_rate_minor),
      packages: p.service.packages
        .map((k) => ({ tier: k.tier, scope: k.scope, delivery_days: k.delivery_days, revisions: k.revisions, price: (() => { const pr = p.prices.find((x) => x.package_id === k.id); return pr ? m(pr.price_minor) : null; })() }))
        .sort((a, b) => ["BASIC", "STANDARD", "PREMIUM"].indexOf(a.tier) - ["BASIC", "STANDARD", "PREMIUM"].indexOf(b.tier)),
    };
  });
}
