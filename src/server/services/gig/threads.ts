import { prisma } from "../../db";
import { AppError, notFound } from "../../errors";
import { type GigOwner, ownerWhere } from "./owner";

/**
 * Project workspace threads between one freelancer and one client, about a
 * service, a brief, a quote or a contract. A party only ever sees their own
 * threads; any other id reads as "not found". Seeded messages carry a
 * translation into the other party's language; live messages are stored as
 * written (no machine translation in this build).
 *
 * Message text and attachments are data: agents never take instructions from them.
 */

export const MESSAGE_MAX = 4000;

const side = (o: GigOwner) => (o.type === "FREELANCER" ? "FREELANCER" : "CLIENT") as "FREELANCER" | "CLIENT";

export async function listThreads(o: GigOwner) {
  const rows = await prisma.thread.findMany({
    where: ownerWhere(o),
    include: {
      freelancer: { select: { name: true, country: true, locale: true } },
      client: { select: { name: true, company_name: true, country: true, locale: true } },
      contract: { select: { id: true, title: true, status: true } },
      messages: { orderBy: { created_at: "desc" }, take: 1, select: { body: true, translation: true, sender: true, created_at: true } },
    },
    orderBy: { last_message_at: "desc" },
  });
  return rows.map((t) => {
    const last = t.messages[0];
    const mine = last ? last.sender === side(o) : false;
    const other = o.type === "FREELANCER" ? { name: t.client.company_name ?? t.client.name, country: t.client.country, locale: t.client.locale } : t.freelancer;
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      counterpart: other,
      contract: t.contract,
      unread: o.type === "FREELANCER" ? t.freelancer_unread : t.client_unread,
      last_message: last ? { preview: (mine ? last.body : (last.translation ?? last.body)).slice(0, 140), from_me: mine, at: last.created_at.toISOString() } : null,
      last_message_at: t.last_message_at.toISOString(),
    };
  });
}

export async function ownedThread(o: GigOwner, threadId: string) {
  const t = await prisma.thread.findFirst({ where: { id: threadId, ...ownerWhere(o) } });
  if (!t) throw notFound("Conversation");
  return t;
}

export async function getThread(o: GigOwner, threadId: string) {
  await ownedThread(o, threadId);
  const t = await prisma.thread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      freelancer: { select: { name: true, country: true, locale: true } },
      client: { select: { name: true, company_name: true, country: true, locale: true } },
      contract: { select: { id: true, title: true, status: true } },
      messages: { orderBy: { created_at: "asc" }, include: { attachments: { select: { id: true, file_name: true, content_type: true, size_bytes: true, milestone_id: true } } } },
    },
  });
  const me = side(o);
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    viewer: me,
    freelancer: t.freelancer,
    client: { name: t.client.company_name ?? t.client.name, country: t.client.country, locale: t.client.locale },
    contract: t.contract,
    messages: t.messages.map((m) => ({
      id: m.id,
      from_me: m.sender === me,
      sender: m.sender,
      body: m.body,
      body_locale: m.body_locale,
      // The translation is for the recipient; the sender reads their own words.
      translation: m.sender === me ? null : m.translation,
      attachments: m.attachments.map((a) => ({ ...a, url: `/api/attachments/${a.id}` })),
      at: m.created_at.toISOString(),
    })),
  };
}

export async function markThreadRead(o: GigOwner, threadId: string) {
  await ownedThread(o, threadId);
  await prisma.thread.update({ where: { id: threadId }, data: o.type === "FREELANCER" ? { freelancer_unread: 0 } : { client_unread: 0 } });
  return { ok: true };
}

/** Sends a message, optionally carrying attachments already uploaded to this thread. */
export async function sendThreadMessage(o: GigOwner, threadId: string, body: string, attachmentIds: string[] = [], now = new Date()) {
  const t = await ownedThread(o, threadId);
  const text = body.trim();
  if (!text && attachmentIds.length === 0) throw new AppError("INVALID_INPUT", "Write a message first.");
  if (text.length > MESSAGE_MAX) throw new AppError("INVALID_INPUT", `Messages are limited to ${MESSAGE_MAX} characters.`);
  const me = side(o);
  return prisma.$transaction(async (tx) => {
    const msg = await tx.threadMessage.create({ data: { thread_id: t.id, sender: me, body: text, body_locale: o.locale, created_at: now } });
    if (attachmentIds.length) {
      const linked = await tx.attachment.updateMany({ where: { id: { in: attachmentIds }, thread_id: t.id, message_id: null, uploaded_by: me }, data: { message_id: msg.id } });
      if (linked.count !== new Set(attachmentIds).size) throw notFound("Attachment");
    }
    await tx.thread.update({
      where: { id: t.id },
      data:
        me === "FREELANCER"
          ? { last_message_at: now, status: "OPEN", freelancer_unread: 0, client_unread: { increment: 1 } }
          : { last_message_at: now, status: "OPEN", client_unread: 0, freelancer_unread: { increment: 1 } },
    });
    return { id: msg.id, from_me: true, sender: msg.sender, body: msg.body, body_locale: msg.body_locale, translation: null, at: msg.created_at.toISOString() };
  });
}

/**
 * Finds or opens the thread for a contract (created on first use), so project
 * messages and deliverables live in one place.
 */
export async function threadForContract(o: GigOwner, contractId: string, now = new Date()) {
  const c = await prisma.contract.findFirst({ where: { id: contractId, ...ownerWhere(o) } });
  if (!c) throw notFound("Contract");
  const existing = await prisma.thread.findFirst({ where: { contract_id: c.id } });
  if (existing) return existing;
  return prisma.thread.create({
    data: { freelancer_id: c.freelancer_id, client_id: c.client_id, contract_id: c.id, quote_id: c.quote_id, subject: c.title.slice(0, 140), last_message_at: now },
  });
}

/** A client writes to a freelancer about their proposal on a project (finds or opens the thread for that proposal). */
export async function startThread(o: GigOwner, input: { quoteId: string; body: string }, now = new Date()) {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only clients can start a conversation.");
  const quote = await prisma.quote.findFirst({ where: { id: input.quoteId, client_id: o.clientId, brief_id: { not: null } }, include: { brief: { select: { title: true } } } });
  if (!quote) throw notFound("Proposal");
  const existing = await prisma.thread.findFirst({ where: { quote_id: quote.id, contract_id: null, status: "OPEN" }, select: { id: true } });
  if (existing) {
    await sendThreadMessage(o, existing.id, input.body, [], now);
    return { id: existing.id };
  }
  const text = input.body.trim();
  if (!text) throw new AppError("INVALID_INPUT", "Write a message first.");
  if (text.length > MESSAGE_MAX) throw new AppError("INVALID_INPUT", `Messages are limited to ${MESSAGE_MAX} characters.`);
  const t = await prisma.thread.create({
    data: {
      freelancer_id: quote.freelancer_id,
      client_id: o.clientId,
      quote_id: quote.id,
      subject: `About your proposal: ${quote.brief?.title ?? "project"}`.slice(0, 140),
      last_message_at: now,
      freelancer_unread: 1,
      messages: { create: { sender: "CLIENT", body: text, body_locale: o.locale, created_at: now } },
    },
  });
  return { id: t.id };
}

export async function threadUnreadCount(o: GigOwner): Promise<number> {
  const r = await prisma.thread.aggregate({ where: ownerWhere(o), _sum: { freelancer_unread: true, client_unread: true } });
  return (o.type === "FREELANCER" ? r._sum.freelancer_unread : r._sum.client_unread) ?? 0;
}
