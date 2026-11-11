import type { PackageTier, Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { getMarket, isMarketLocale, MARKET_LOCALES } from "../../domain/markets";
import { money } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { enqueueGigEmbedding } from "../../queue";
import { asJson } from "../audit";

/**
 * Freelancer services, their packages, and one localized service page per
 * market. Every query filters by freelancer_id, so another freelancer's id
 * reads as "not found". Agents save pages as DRAFT; publishing is the
 * freelancer's click.
 */

export const SEO_TITLE_MAX = 70;
export const TIERS: readonly PackageTier[] = ["BASIC", "STANDARD", "PREMIUM"];

const packageSchema = z.object({
  tier: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
  scope: z.string().trim().min(3).max(500),
  delivery_days: z.number().int().min(1).max(365),
  revisions: z.number().int().min(0).max(20),
  estimated_hours: z.number().int().min(1).max(1000),
});

export const serviceInputSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().min(10).max(5000),
    source_locale: z.enum(MARKET_LOCALES),
    category: z.string().trim().min(2).max(60),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    pricing_model: z.enum(["PACKAGES", "HOURLY"]),
    packages: z.array(packageSchema).max(3).default([]),
  })
  .superRefine((s, ctx) => {
    if (s.pricing_model === "PACKAGES") {
      if (s.packages.length === 0) ctx.addIssue({ code: "custom", message: "A package service needs 1 to 3 packages (Basic, Standard, Premium)." });
      if (new Set(s.packages.map((p) => p.tier)).size !== s.packages.length) ctx.addIssue({ code: "custom", message: "Each package tier can appear once." });
    } else if (s.packages.length) {
      ctx.addIssue({ code: "custom", message: "An hourly service has no packages." });
    }
  });
export type ServiceInput = z.input<typeof serviceInputSchema>;

/**
 * Creates a service. Base prices are the freelancer's floor (estimated hours x
 * hourly floor, in their home currency); market prices come from suggest_rate.
 */
export async function createService(freelancerId: string, input: ServiceInput) {
  const data = serviceInputSchema.parse(input);
  const f = await prisma.freelancer.findUnique({ where: { id: freelancerId } });
  if (!f) throw notFound("Freelancer");
  const code = data.code.toUpperCase();
  if (await prisma.service.findUnique({ where: { freelancer_id_code: { freelancer_id: freelancerId, code } } })) {
    throw new AppError("CONFLICT", `You already have a service with code ${code}.`);
  }
  return prisma.service.create({
    data: {
      freelancer_id: freelancerId,
      code,
      title: data.title,
      description: data.description,
      source_locale: data.source_locale,
      category: data.category,
      tags: data.tags,
      pricing_model: data.pricing_model,
      currency: f.currency,
      hourly_rate_minor: data.pricing_model === "HOURLY" ? f.hourly_floor_minor : null,
      packages: {
        create: data.packages.map((p) => ({
          tier: p.tier,
          name: p.tier[0] + p.tier.slice(1).toLowerCase(),
          scope: p.scope,
          delivery_days: p.delivery_days,
          revisions: p.revisions,
          estimated_hours: p.estimated_hours,
          base_price_minor: p.estimated_hours * f.hourly_floor_minor,
        })),
      },
    },
    include: { packages: true },
  });
}

export async function ownedService(freelancerId: string, serviceId: string) {
  const s = await prisma.service.findFirst({
    where: { id: serviceId, freelancer_id: freelancerId },
    include: {
      packages: { orderBy: { tier: "asc" } },
      pages: { include: { prices: true }, orderBy: { locale: "asc" } },
      freelancer: { select: { currency: true, hourly_floor_minor: true, locale: true, country: true } },
    },
  });
  if (!s) throw notFound("Service");
  return s;
}

/** get_service: the service, its packages and its page in every market. */
export async function serviceView(freelancerId: string, serviceId: string) {
  const s = await ownedService(freelancerId, serviceId);
  const home = (minor: number) => money(minor, s.currency, s.freelancer.locale);
  return {
    service_id: s.id,
    code: s.code,
    title: s.title,
    description: s.description,
    written_in: s.source_locale,
    category: s.category,
    tags: s.tags,
    pricing_model: s.pricing_model,
    home_currency: s.currency,
    hourly_floor: home(s.freelancer.hourly_floor_minor),
    hourly_rate: s.hourly_rate_minor === null ? null : home(s.hourly_rate_minor),
    packages: s.packages.map((p) => ({
      package_id: p.id,
      tier: p.tier,
      scope: p.scope,
      delivery_days: p.delivery_days,
      revisions: p.revisions,
      estimated_hours: p.estimated_hours,
      floor_price_in_home_currency: home(p.estimated_hours * s.freelancer.hourly_floor_minor),
    })),
    pages: s.pages.map((pg) => pageView(pg, s.packages)),
  };
}

type PageRow = Prisma.ServicePageGetPayload<{ include: { prices: true } }>;

export function pageView(pg: PageRow, packages: { id: string; tier: PackageTier }[]) {
  const m = (minor: number) => money(minor, pg.currency, pg.locale);
  return {
    page_id: pg.id,
    market: pg.locale,
    currency: pg.currency,
    status: pg.status,
    title: pg.title,
    seo_title: pg.seo_title,
    hourly_rate: pg.hourly_rate_minor === null ? null : m(pg.hourly_rate_minor),
    prices: pg.prices
      .map((p) => ({ tier: packages.find((k) => k.id === p.package_id)?.tier ?? null, package_id: p.package_id, price: m(p.price_minor) }))
      .sort((a, b) => TIERS.indexOf(a.tier!) - TIERS.indexOf(b.tier!)),
    published_at: pg.published_at?.toISOString() ?? null,
  };
}

export async function listServices(freelancerId: string) {
  const rows = await prisma.service.findMany({
    where: { freelancer_id: freelancerId },
    include: { packages: true, pages: { include: { prices: true } } },
    orderBy: { created_at: "asc" },
  });
  return rows.map((s) => ({
    service_id: s.id,
    code: s.code,
    title: s.title,
    category: s.category,
    pricing_model: s.pricing_model,
    markets: s.pages.map((p) => ({ market: p.locale, status: p.status })),
  }));
}

export type PageDraft = {
  serviceId: string;
  locale: string;
  title: string;
  description: string;
  seoTitle: string;
  /** Package prices in the market currency, minor units (PACKAGES services). */
  prices: { packageId: string; priceMinor: number }[];
  /** HOURLY services. */
  hourlyRateMinor: number | null;
  /** The suggest_rate quote the prices came from. */
  pricing: unknown;
};

function checkSeo(seoTitle: string) {
  const len = [...seoTitle.trim()].length;
  if (len === 0 || len > SEO_TITLE_MAX) throw new AppError("INVALID_INPUT", `The SEO title must be 1 to ${SEO_TITLE_MAX} characters; it has ${len}.`);
}

/** Saves (or replaces) the DRAFT page for one market. A published page goes back to DRAFT. */
export async function saveServicePageDraft(freelancerId: string, d: PageDraft) {
  if (!isMarketLocale(d.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${d.locale}.`);
  checkSeo(d.seoTitle);
  const s = await ownedService(freelancerId, d.serviceId);
  const currency = getMarket(d.locale).currency;
  if (s.pricing_model === "PACKAGES") {
    const ids = new Set(s.packages.map((p) => p.id));
    if (d.prices.length !== s.packages.length || d.prices.some((p) => !ids.has(p.packageId))) {
      throw new AppError("INVALID_INPUT", "Give a price for every package of this service.");
    }
  } else if (d.hourlyRateMinor === null) {
    throw new AppError("INVALID_INPUT", "An hourly service needs an hourly rate.");
  }
  if (d.prices.some((p) => !Number.isSafeInteger(p.priceMinor) || p.priceMinor <= 0)) throw new AppError("INVALID_INPUT", "Prices must be positive.");
  return prisma.$transaction(async (tx) => {
    const page = await tx.servicePage.upsert({
      where: { service_id_locale: { service_id: s.id, locale: d.locale } },
      create: {
        service_id: s.id,
        freelancer_id: freelancerId,
        locale: d.locale,
        currency,
        title: d.title.trim(),
        description: d.description.trim(),
        seo_title: d.seoTitle.trim(),
        hourly_rate_minor: d.hourlyRateMinor,
        status: "DRAFT",
        pricing: asJson(d.pricing),
      },
      update: {
        title: d.title.trim(),
        description: d.description.trim(),
        seo_title: d.seoTitle.trim(),
        hourly_rate_minor: d.hourlyRateMinor,
        status: "DRAFT",
        published_at: null,
        pricing: asJson(d.pricing),
      },
    });
    await tx.servicePagePrice.deleteMany({ where: { page_id: page.id } });
    if (d.prices.length) await tx.servicePagePrice.createMany({ data: d.prices.map((p) => ({ page_id: page.id, package_id: p.packageId, price_minor: p.priceMinor })) });
    return tx.servicePage.findUniqueOrThrow({ where: { id: page.id }, include: { prices: true } });
  });
}

/** Changes only the prices of an existing page; it goes back to DRAFT for review. */
export async function setServicePagePrices(freelancerId: string, serviceId: string, locale: string, prices: { packageId: string; priceMinor: number }[], hourlyRateMinor: number | null, pricing: unknown) {
  const before = await prisma.servicePage.findFirst({ where: { service_id: serviceId, locale, freelancer_id: freelancerId }, include: { prices: true } });
  if (!before) throw new AppError("NOT_FOUND", `This service has no page in ${locale} yet. Write one with save_service_draft first.`);
  const page = await saveServicePageDraft(freelancerId, { serviceId, locale, title: before.title, description: before.description, seoTitle: before.seo_title, prices, hourlyRateMinor, pricing });
  return { before, page };
}

export async function publishServicePage(freelancerId: string, pageId: string) {
  const page = await prisma.servicePage.findFirst({ where: { id: pageId, freelancer_id: freelancerId }, include: { service: { include: { packages: true } }, prices: true } });
  if (!page) throw notFound("Service page");
  if (page.service.pricing_model === "PACKAGES" && page.prices.length !== page.service.packages.length) {
    throw new AppError("CONFLICT", "Price every package before publishing.");
  }
  const updated = await prisma.servicePage.update({ where: { id: page.id }, data: { status: "PUBLISHED", published_at: new Date() } });
  await enqueueGigEmbedding({ kind: "service_page", id: updated.id }).catch((err: unknown) => console.error("embedding enqueue failed; the worker backfills on boot", err));
  return updated;
}

export async function unpublishServicePage(freelancerId: string, pageId: string) {
  const moved = await prisma.servicePage.updateMany({ where: { id: pageId, freelancer_id: freelancerId, status: "PUBLISHED" }, data: { status: "DRAFT", published_at: null } });
  if (moved.count === 0 && !(await prisma.servicePage.findFirst({ where: { id: pageId, freelancer_id: freelancerId } }))) throw notFound("Service page");
  return { page_id: pageId, status: "DRAFT" as const };
}
