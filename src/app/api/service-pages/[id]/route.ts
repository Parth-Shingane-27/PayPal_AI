import { z } from "zod";
import { requireFreelancer } from "@/server/auth";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { handler, json, readBody, routeId } from "@/server/http";
import { saveServicePageDraft, SEO_TITLE_MAX } from "@/server/services/gig/catalog";

const body = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(5000),
  seo_title: z.string().trim().min(1).max(SEO_TITLE_MAX),
});

/** The freelancer edits a page's text by hand. Prices stay as they are; the page goes back to DRAFT for review. */
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const f = await requireFreelancer(req);
  const id = await routeId(ctx.params, "Service page");
  const b = await readBody(req, body);
  const page = await prisma.servicePage.findFirst({ where: { id, freelancer_id: f.freelancerId }, include: { prices: true } });
  if (!page) throw notFound("Service page");
  const saved = await saveServicePageDraft(f.freelancerId, {
    serviceId: page.service_id,
    locale: page.locale,
    title: b.title,
    description: b.description,
    seoTitle: b.seo_title,
    prices: page.prices.map((p) => ({ packageId: p.package_id, priceMinor: p.price_minor })),
    hourlyRateMinor: page.hourly_rate_minor,
    pricing: page.pricing,
  });
  return json({ page_id: saved.id, status: saved.status });
});
