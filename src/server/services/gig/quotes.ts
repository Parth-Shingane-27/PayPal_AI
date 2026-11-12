import type { Quote } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { getMarket, isMarketLocale } from "../../domain/markets";
import { money, parseDecimal } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { type GigOwner, ownerWhere } from "./owner";

/**
 * Proposals (stored as quotes): a freelancer answers an OPEN project with a
 * price (SENT), and a contract made from it marks it ACCEPTED (on funding of
 * the first milestone, see milestones.markFunded).
 */

export const QUOTE_MESSAGE_MAX = 4000;
const DEFAULT_VALID_DAYS = 14;
const DAY = 86_400_000;

export const sendQuoteSchema = z.object({
  total: z.string().trim().regex(/^\d+(\.\d+)?$/, "Use digits, e.g. 1200 or 1200.50"),
  delivery_days: z.number().int().min(1).max(365),
  revisions: z.number().int().min(0).max(20),
  scope: z.string().trim().min(10).max(QUOTE_MESSAGE_MAX),
  message: z.string().trim().max(QUOTE_MESSAGE_MAX).nullable().default(null),
  valid_days: z.number().int().min(1).max(60).default(DEFAULT_VALID_DAYS),
});

/** A SENT quote whose validity has passed reads as EXPIRED (and is stored as such on the next write). */
function effectiveStatus(q: Quote, now: Date): Quote["status"] {
  return q.status === "SENT" && q.expires_at && q.expires_at < now ? "EXPIRED" : q.status;
}

export function quoteView(q: Quote & { freelancer?: { name: string } | null; client?: { name: string; company_name: string | null } | null; brief?: { title: string } | null }, locale: string, now = new Date()) {
  return {
    quote_id: q.id,
    status: effectiveStatus(q, now),
    brief_id: q.brief_id,
    brief_title: q.brief?.title ?? null,
    market: q.locale,
    request_message: q.request_message,
    total: q.total_minor === null ? null : money(q.total_minor, q.currency, locale),
    delivery_days: q.delivery_days,
    revisions: q.revisions,
    scope: q.scope,
    message: q.message,
    requested_at: q.requested_at.toISOString(),
    sent_at: q.sent_at?.toISOString() ?? null,
    expires_at: q.expires_at?.toISOString() ?? null,
    freelancer: q.freelancer ? { name: q.freelancer.name } : undefined,
    client: q.client ? { name: q.client.company_name ?? q.client.name } : undefined,
  };
}

/**
 * A freelancer's proposal on an OPEN project. It is created straight in SENT
 * with the price in the client's currency; sending again before the client
 * builds a plan on it revises the same proposal.
 */
export async function sendProposal(o: GigOwner, briefId: string, input: z.input<typeof sendQuoteSchema>, now = new Date()) {
  if (o.type !== "FREELANCER") throw new AppError("FORBIDDEN", "Only freelancers send proposals.");
  const data = sendQuoteSchema.parse(input);
  const brief = await prisma.brief.findFirst({ where: { id: briefId, status: "OPEN" } });
  if (!brief) throw notFound("Project");
  if (!isMarketLocale(brief.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${brief.locale}.`);
  const currency = getMarket(brief.locale).currency;
  const total = parseDecimal(data.total, currency);
  if (total <= 0) throw new AppError("INVALID_INPUT", "The total must be more than zero.");
  const fields = {
    status: "SENT" as const,
    total_minor: total,
    delivery_days: data.delivery_days,
    revisions: data.revisions,
    scope: data.scope,
    message: data.message,
    sent_at: now,
    expires_at: new Date(now.getTime() + data.valid_days * DAY),
  };
  const existing = await prisma.quote.findFirst({
    where: { brief_id: brief.id, freelancer_id: o.freelancerId },
    include: { contract: { select: { id: true } } },
    orderBy: { created_at: "desc" },
  });
  if (existing && (existing.status === "SENT" || existing.status === "ACCEPTED")) {
    if (existing.status === "ACCEPTED") throw new AppError("CONFLICT", "The client already accepted your proposal.");
    if (existing.contract) throw new AppError("CONFLICT", "The client already built a milestone plan on your proposal. Ask them before changing the price.");
    return { ...quoteView(await prisma.quote.update({ where: { id: existing.id }, data: fields }), o.locale, now), revised: true };
  }
  const quote = await prisma.quote.create({
    data: { client_id: brief.client_id, freelancer_id: o.freelancerId, brief_id: brief.id, locale: brief.locale, currency, request_message: brief.title, requested_at: now, ...fields },
  });
  return { ...quoteView(quote, o.locale, now), revised: false };
}

/** The proposals on one of the client's projects, with enough about each freelancer to compare. */
export async function listProposals(o: GigOwner, briefId: string, now = new Date()) {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only the client sees the proposals on a project.");
  const brief = await prisma.brief.findFirst({ where: { id: briefId, client_id: o.clientId }, select: { id: true } });
  if (!brief) throw notFound("Project");
  const rows = await prisma.quote.findMany({
    where: { brief_id: brief.id, status: { in: ["SENT", "ACCEPTED", "DECLINED", "EXPIRED"] } },
    include: {
      freelancer: { select: { name: true, headline: true, skills: true, languages: true, country: true, timezone: true } },
      client: { select: { name: true, company_name: true } },
    },
    orderBy: { sent_at: "desc" },
    take: 100,
  });
  return rows.map((q) => ({ ...quoteView(q, o.locale, now), freelancer: { name: q.freelancer.name, headline: q.freelancer.headline, skills: q.freelancer.skills, languages: q.freelancer.languages, country: q.freelancer.country, timezone: q.freelancer.timezone } }));
}

/** The freelancer revises a proposal that is not yet accepted. */
export async function sendQuote(o: GigOwner, quoteId: string, input: z.input<typeof sendQuoteSchema>, now = new Date()) {
  if (o.type !== "FREELANCER") throw new AppError("FORBIDDEN", "Only the freelancer can price a quote.");
  const data = sendQuoteSchema.parse(input);
  const q = await prisma.quote.findFirst({ where: { id: quoteId, freelancer_id: o.freelancerId }, include: { contract: { select: { id: true } } } });
  if (!q) throw notFound("Quote");
  if (q.status !== "SENT") throw new AppError("CONFLICT", `This proposal is ${q.status.toLowerCase()} and cannot be changed.`);
  if (q.contract) throw new AppError("CONFLICT", "The client already built a milestone plan on this quote. Ask them before changing the price.");
  const total = parseDecimal(data.total, q.currency);
  if (total <= 0) throw new AppError("INVALID_INPUT", "The total must be more than zero.");
  const updated = await prisma.quote.update({
    where: { id: q.id },
    data: {
      status: "SENT",
      total_minor: total,
      delivery_days: data.delivery_days,
      revisions: data.revisions,
      scope: data.scope,
      message: data.message,
      sent_at: now,
      expires_at: new Date(now.getTime() + data.valid_days * DAY),
    },
  });
  return quoteView(updated, o.locale, now);
}

/** The freelancer withdraws a proposal, or the client turns one down. */
export async function closeQuote(o: GigOwner, quoteId: string, now = new Date()) {
  const q = await prisma.quote.findFirst({ where: { id: quoteId, ...ownerWhere(o) }, include: { contract: { select: { status: true } } } });
  if (!q) throw notFound("Quote");
  if (q.status !== "SENT") throw new AppError("CONFLICT", `This proposal is already ${q.status.toLowerCase()}.`);
  if (q.contract && q.contract.status !== "DRAFT") throw new AppError("CONFLICT", "A contract was already started from this quote.");
  const status = o.type === "FREELANCER" ? "WITHDRAWN" : "DECLINED";
  const updated = await prisma.quote.update({ where: { id: q.id }, data: { status, decided_at: now } });
  return quoteView(updated, o.locale, now);
}

export async function viewQuote(o: GigOwner, quoteId: string, now = new Date()) {
  const q = await prisma.quote.findFirst({
    where: { id: quoteId, ...ownerWhere(o) },
    include: { freelancer: { select: { name: true } }, client: { select: { name: true, company_name: true } } },
  });
  if (!q) throw notFound("Quote");
  return quoteView(q, o.locale, now);
}

export async function listQuotes(o: GigOwner, opts: { status?: Quote["status"] } = {}, now = new Date()) {
  const rows = await prisma.quote.findMany({
    where: { ...ownerWhere(o), ...(opts.status ? { status: opts.status } : {}) },
    include: { freelancer: { select: { name: true } }, client: { select: { name: true, company_name: true } }, brief: { select: { title: true } } },
    orderBy: { requested_at: "desc" },
    take: 200,
  });
  return rows.map((q) => quoteView(q, o.locale, now));
}

/** 2 to 4 of the client's proposals side by side: price, time, revisions and facts about each freelancer. */
export async function compareProposals(o: GigOwner, quoteIds: string[], now = new Date()) {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only the client compares proposals.");
  const rows = await prisma.quote.findMany({
    where: { id: { in: quoteIds }, client_id: o.clientId, brief_id: { not: null } },
    include: {
      freelancer: { select: { id: true, name: true, headline: true, skills: true, languages: true, country: true, timezone: true, availability: true } },
      client: { select: { name: true, company_name: true } },
    },
  });
  if (rows.length !== new Set(quoteIds).size) throw notFound("Proposal");
  const delivered = await prisma.milestone.groupBy({
    by: ["freelancer_id"],
    where: { freelancer_id: { in: rows.map((r) => r.freelancer_id) }, state: "ACCEPTED" },
    _count: true,
  });
  return rows.map((q) => ({
    ...quoteView(q, o.locale, now),
    freelancer: {
      name: q.freelancer.name,
      headline: q.freelancer.headline,
      skills: q.freelancer.skills,
      languages: q.freelancer.languages,
      country: q.freelancer.country,
      timezone: q.freelancer.timezone,
      availability: q.freelancer.availability,
      milestones_accepted: delivered.find((d) => d.freelancer_id === q.freelancer_id)?._count ?? 0,
    },
  }));
}
