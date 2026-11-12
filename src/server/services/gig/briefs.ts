import { z } from "zod";
import { prisma } from "../../db";
import { getMarket, isMarketLocale } from "../../domain/markets";
import { money, parseDecimal } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import type { GigOwner } from "./owner";

/**
 * Client briefs: what the client wants done, in their own words. The text is
 * data for freelancers and agents, never instructions to either.
 */

export const BRIEF_TEXT_MAX = 6000;

export const briefInputSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(BRIEF_TEXT_MAX),
  skills: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  /** Decimal in the client's market currency, e.g. "1200". */
  budget: z.string().trim().regex(/^\d+(\.\d+)?$/).nullable().default(null),
  /** YYYY-MM-DD. */
  deadline: z.iso.date().nullable().default(null),
});
export type BriefInput = z.input<typeof briefInputSchema>;

function clientOf(o: GigOwner): string {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only clients write briefs.");
  return o.clientId;
}

function marketCurrency(o: GigOwner): string {
  if (!isMarketLocale(o.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${o.locale}.`);
  return getMarket(o.locale).currency;
}

type BriefRow = Awaited<ReturnType<typeof prisma.brief.findUniqueOrThrow>>;

export function briefView(b: BriefRow, locale: string) {
  return {
    brief_id: b.id,
    title: b.title,
    description: b.description,
    written_in: b.locale,
    skills: b.skills,
    budget: b.budget_minor !== null && b.budget_currency ? money(b.budget_minor, b.budget_currency, locale) : null,
    deadline: b.deadline?.toISOString().slice(0, 10) ?? null,
    status: b.status,
    updated_at: b.updated_at.toISOString(),
  };
}

/** draft_brief and the brief form: creates a DRAFT, or updates one the client owns. */
export async function saveBrief(o: GigOwner, input: BriefInput, briefId?: string | null) {
  const clientId = clientOf(o);
  const data = briefInputSchema.parse(input);
  const currency = marketCurrency(o);
  const fields = {
    title: data.title,
    description: data.description,
    skills: data.skills,
    budget_minor: data.budget === null ? null : parseDecimal(data.budget, currency),
    budget_currency: data.budget === null ? null : currency,
    deadline: data.deadline ? new Date(`${data.deadline}T00:00:00.000Z`) : null,
  };
  if (briefId) {
    const existing = await prisma.brief.findFirst({ where: { id: briefId, client_id: clientId } });
    if (!existing) throw notFound("Brief");
    if (existing.status === "CLOSED") throw new AppError("CONFLICT", "This brief is closed. Start a new one.");
    return briefView(await prisma.brief.update({ where: { id: existing.id }, data: fields }), o.locale);
  }
  return briefView(await prisma.brief.create({ data: { client_id: clientId, locale: o.locale, status: "DRAFT", ...fields } }), o.locale);
}

export async function getBrief(o: GigOwner, briefId: string) {
  const b = await prisma.brief.findFirst({ where: { id: briefId, client_id: clientOf(o) } });
  if (!b) throw notFound("Brief");
  return briefView(b, o.locale);
}

export async function listBriefs(o: GigOwner) {
  const rows = await prisma.brief.findMany({ where: { client_id: clientOf(o) }, orderBy: { updated_at: "desc" }, take: 100, include: { _count: { select: { quotes: true } } } });
  // Drafts and open projects first: they are the ones that need the client.
  const rank = { DRAFT: 0, OPEN: 1, CLOSED: 2 } as const;
  return rows.map((b) => ({ ...briefView(b, o.locale), quotes: b._count.quotes })).sort((a, b) => rank[a.status] - rank[b.status]);
}

export async function closeBrief(o: GigOwner, briefId: string) {
  const moved = await prisma.brief.updateMany({ where: { id: briefId, client_id: clientOf(o), status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
  if (moved.count === 0) await getBrief(o, briefId); // 404 for someone else's, no-op if already closed
  return { brief_id: briefId, status: "CLOSED" as const };
}

/** Client publishes a DRAFT project so freelancers can see it on the board. */
export async function publishBrief(o: GigOwner, briefId: string) {
  const clientId = clientOf(o);
  const moved = await prisma.brief.updateMany({ where: { id: briefId, client_id: clientId, status: "DRAFT" }, data: { status: "OPEN" } });
  if (moved.count === 0) {
    const b = await prisma.brief.findFirst({ where: { id: briefId, client_id: clientId } });
    if (!b) throw notFound("Project");
    if (b.status === "CLOSED") throw new AppError("CONFLICT", "This project is closed. Start a new one.");
  }
  return getBrief(o, briefId);
}

/** What a freelancer sees of an open project: the client's display name and market, never contact details. */
export function boardView(
  b: BriefRow & { client: { name: string; company_name: string | null }; _count?: { quotes: number }; quotes?: { id: string; status: string }[] },
  locale: string,
  freelancerSkills: string[] = [],
) {
  const mine = b.quotes?.[0] ?? null;
  const wanted = new Set(freelancerSkills.map((x) => x.toLowerCase()));
  return {
    ...briefView(b, locale),
    client: b.client.company_name ?? b.client.name,
    market: b.locale,
    /** The currency a proposal on this project is priced in (the client's market currency). */
    currency: isMarketLocale(b.locale) ? getMarket(b.locale).currency : "USD",
    matching_skills: b.skills.filter((x) => wanted.has(x.toLowerCase())),
    proposals: b._count?.quotes ?? 0,
    my_proposal: mine ? { quote_id: mine.id, status: mine.status } : null,
  };
}

export type BoardFilters = { skills?: string[]; language?: string | null; q?: string | null; limit?: number };

/**
 * The project board: OPEN projects, ranked by how many of the freelancer's
 * skills they ask for (deterministic), then newest first.
 */
export async function listOpenBriefs(o: GigOwner, filters: BoardFilters = {}) {
  if (o.type !== "FREELANCER") throw new AppError("FORBIDDEN", "Only freelancers browse the project board.");
  const me = await prisma.freelancer.findUniqueOrThrow({ where: { id: o.freelancerId }, select: { skills: true } });
  const q = filters.q?.trim();
  const rows = await prisma.brief.findMany({
    where: {
      status: "OPEN",
      ...(filters.language ? { locale: { startsWith: filters.language } } : {}),
      ...(filters.skills?.length ? { skills: { hasSome: filters.skills } } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: {
      client: { select: { name: true, company_name: true } },
      _count: { select: { quotes: true } },
      quotes: { where: { freelancer_id: o.freelancerId }, select: { id: true, status: true }, take: 1 },
    },
    orderBy: { created_at: "desc" },
    take: 200,
  });
  const views = rows.map((b) => boardView(b, o.locale, me.skills));
  const limit = Math.min(filters.limit ?? 50, 100);
  // Array.sort is stable, so equal scores keep their newest-first order.
  return views.sort((a, b) => b.matching_skills.length - a.matching_skills.length).slice(0, limit);
}

/** One open project for a freelancer (or one they already sent a proposal on). */
export async function getOpenBrief(o: GigOwner, briefId: string) {
  if (o.type !== "FREELANCER") throw new AppError("FORBIDDEN", "Only freelancers browse the project board.");
  const me = await prisma.freelancer.findUniqueOrThrow({ where: { id: o.freelancerId }, select: { skills: true } });
  const b = await prisma.brief.findFirst({
    where: { id: briefId, OR: [{ status: "OPEN" }, { quotes: { some: { freelancer_id: o.freelancerId } } }] },
    include: {
      client: { select: { name: true, company_name: true } },
      _count: { select: { quotes: true } },
      quotes: { where: { freelancer_id: o.freelancerId }, select: { id: true, status: true }, take: 1 },
    },
  });
  if (!b) throw notFound("Project");
  return boardView(b, o.locale, me.skills);
}
