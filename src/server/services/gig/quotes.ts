import type { Quote } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { getMarket, isMarketLocale } from "../../domain/markets";
import { money, parseDecimal } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { type GigOwner, ownerWhere } from "./owner";

/**
 * Quotes: a client asks a freelancer for a price (REQUESTED), the freelancer
 * answers with one (SENT), and a contract made from it marks it ACCEPTED (on
 * funding of the first milestone, see milestones.markFunded).
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

export function quoteView(q: Quote & { freelancer?: { name: string } | null; client?: { name: string; company_name: string | null } | null }, locale: string, now = new Date()) {
  return {
    quote_id: q.id,
    status: effectiveStatus(q, now),
    brief_id: q.brief_id,
    service_id: q.service_id,
    package_id: q.package_id,
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
 * request_quote: the client asks for a price, about a published service page
 * in their market or directly to a freelancer, optionally with a brief.
 */
export async function requestQuote(
  o: GigOwner,
  input: { servicePageId?: string | null; freelancerId?: string | null; briefId?: string | null; message: string },
  now = new Date(),
) {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only clients request quotes.");
  if (!isMarketLocale(o.locale)) throw new AppError("INVALID_INPUT", `Unknown market ${o.locale}.`);
  const message = input.message.trim();
  if (!message) throw new AppError("INVALID_INPUT", "Say what you need so the freelancer can price it.");
  if (message.length > QUOTE_MESSAGE_MAX) throw new AppError("INVALID_INPUT", `Messages are limited to ${QUOTE_MESSAGE_MAX} characters.`);

  let freelancerId: string;
  let serviceId: string | null = null;
  let pageId: string | null = null;
  if (input.servicePageId) {
    const page = await prisma.servicePage.findFirst({ where: { id: input.servicePageId, status: "PUBLISHED" } });
    if (!page) throw notFound("Service");
    freelancerId = page.freelancer_id;
    serviceId = page.service_id;
    pageId = page.id;
  } else if (input.freelancerId) {
    const f = await prisma.freelancer.findFirst({ where: { id: input.freelancerId, service_pages: { some: { status: "PUBLISHED" } } }, select: { id: true } });
    if (!f) throw notFound("Freelancer");
    freelancerId = f.id;
  } else {
    throw new AppError("INVALID_INPUT", "Say which service or freelancer the quote is for.");
  }

  let briefId: string | null = null;
  if (input.briefId) {
    const b = await prisma.brief.findFirst({ where: { id: input.briefId, client_id: o.clientId } });
    if (!b) throw notFound("Brief");
    if (b.status === "CLOSED") throw new AppError("CONFLICT", "This brief is closed.");
    briefId = b.id;
  }

  const open = await prisma.quote.findFirst({
    where: { client_id: o.clientId, freelancer_id: freelancerId, brief_id: briefId, service_id: serviceId, status: { in: ["REQUESTED", "SENT"] } },
  });
  if (open && effectiveStatus(open, now) !== "EXPIRED") {
    return { ...quoteView(open, o.locale, now), already_requested: true };
  }

  const quote = await prisma.$transaction(async (tx) => {
    const q = await tx.quote.create({
      data: {
        client_id: o.clientId,
        freelancer_id: freelancerId,
        brief_id: briefId,
        service_id: serviceId,
        locale: o.locale,
        currency: getMarket(o.locale).currency,
        status: "REQUESTED",
        request_message: message,
        requested_at: now,
      },
    });
    if (briefId) await tx.brief.updateMany({ where: { id: briefId, status: "DRAFT" }, data: { status: "OPEN" } });
    if (pageId) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      await tx.servicePageDailyStat.upsert({
        where: { page_id_day: { page_id: pageId, day } },
        create: { page_id: pageId, day, quote_requests: 1 },
        update: { quote_requests: { increment: 1 } },
      });
    }
    return q;
  });
  return {
    ...quoteView(quote, o.locale, now),
    already_requested: false,
    next_step: "The freelancer will answer with a price. Nothing is charged by requesting a quote.",
  };
}

/** The freelancer prices a requested quote (or revises one not yet accepted). */
export async function sendQuote(o: GigOwner, quoteId: string, input: z.input<typeof sendQuoteSchema>, now = new Date()) {
  if (o.type !== "FREELANCER") throw new AppError("FORBIDDEN", "Only the freelancer can price a quote.");
  const data = sendQuoteSchema.parse(input);
  const q = await prisma.quote.findFirst({ where: { id: quoteId, freelancer_id: o.freelancerId }, include: { contract: { select: { id: true } } } });
  if (!q) throw notFound("Quote");
  if (q.status !== "REQUESTED" && q.status !== "SENT") throw new AppError("CONFLICT", `This quote is ${q.status.toLowerCase()} and cannot be changed.`);
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

/** Freelancer declines a request, or the client turns a price down / withdraws the request. */
export async function closeQuote(o: GigOwner, quoteId: string, now = new Date()) {
  const q = await prisma.quote.findFirst({ where: { id: quoteId, ...ownerWhere(o) }, include: { contract: { select: { status: true } } } });
  if (!q) throw notFound("Quote");
  if (q.status !== "REQUESTED" && q.status !== "SENT") throw new AppError("CONFLICT", `This quote is already ${q.status.toLowerCase()}.`);
  if (q.contract && q.contract.status !== "DRAFT") throw new AppError("CONFLICT", "A contract was already started from this quote.");
  const status = o.type === "FREELANCER" ? "DECLINED" : q.status === "REQUESTED" ? "WITHDRAWN" : "DECLINED";
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
    include: { freelancer: { select: { name: true } }, client: { select: { name: true, company_name: true } } },
    orderBy: { requested_at: "desc" },
    take: 200,
  });
  return rows.map((q) => quoteView(q, o.locale, now));
}

/** Quote requests a freelancer has not answered for longer than `olderThanMs` (detector input). */
export function unansweredQuoteRequests(freelancerId: string, olderThanMs: number, now = new Date()) {
  return prisma.quote.findMany({
    where: { freelancer_id: freelancerId, status: "REQUESTED", requested_at: { lt: new Date(now.getTime() - olderThanMs) } },
    orderBy: { requested_at: "asc" },
  });
}
