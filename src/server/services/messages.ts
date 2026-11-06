import { z } from "zod";
import type { Principal } from "../auth";
import { prisma } from "../db";
import { money } from "../domain/money";
import { AppError, notFound } from "../errors";

/**
 * Buyer-seller conversations. A principal only ever sees threads where they
 * are the buyer or the seller; any other id reads as "not found".
 * Seeded messages carry a translation into the other party's language; live
 * replies are stored as written (no machine translation in this build).
 */

export const MESSAGE_MAX = 2000;
export const messageBodySchema = z.object({ body: z.string().trim().min(1, "Write a message first.").max(MESSAGE_MAX) });
export const startConversationSchema = z.object({
  product_id: z.uuid(),
  body: z.string().trim().min(1, "Write a message first.").max(MESSAGE_MAX),
});

const ownerWhere = (p: Principal) => (p.role === "SELLER" ? { seller_id: p.sellerId } : { buyer_id: p.buyerId });
const viewerLocale = (p: Principal) => (p.role === "SELLER" ? p.locale : p.market);

export async function listConversations(p: Principal) {
  const rows = await prisma.conversation.findMany({
    where: ownerWhere(p),
    include: {
      seller: { select: { id: true, name: true, country: true, locale: true } },
      buyer: { select: { id: true, name: true, country: true, locale: true } },
      product: { select: { id: true, title: true, image_url: true, listings: { where: { locale: viewerLocale(p) }, select: { title: true } } } },
      messages: { orderBy: { created_at: "desc" }, take: 1, select: { body: true, translation: true, sender: true, created_at: true } },
    },
    orderBy: { last_message_at: "desc" },
  });
  return rows.map((c) => {
    const counterpart = p.role === "SELLER" ? c.buyer : c.seller;
    const last = c.messages[0];
    const mine = last ? last.sender === p.role : false;
    return {
      id: c.id,
      subject: c.subject,
      status: c.status,
      counterpart: { name: counterpart.name, country: counterpart.country, locale: counterpart.locale },
      product: c.product ? { id: c.product.id, title: c.product.listings[0]?.title ?? c.product.title, image_url: c.product.image_url } : null,
      order_id: c.order_id,
      unread: p.role === "SELLER" ? c.seller_unread : c.buyer_unread,
      last_message: last
        ? { preview: (mine ? last.body : (last.translation ?? last.body)).slice(0, 140), from_me: mine, at: last.created_at.toISOString() }
        : null,
      last_message_at: c.last_message_at.toISOString(),
    };
  });
}

async function ownedConversation(p: Principal, id: string) {
  const c = await prisma.conversation.findFirst({ where: { id, ...ownerWhere(p) } });
  if (!c) throw notFound("Conversation");
  return c;
}

export async function getConversation(p: Principal, id: string) {
  await ownedConversation(p, id);
  const c = await prisma.conversation.findUniqueOrThrow({
    where: { id },
    include: {
      seller: { select: { name: true, country: true, locale: true } },
      buyer: { select: { name: true, country: true, locale: true } },
      product: { select: { id: true, title: true, image_url: true, listings: { where: { locale: viewerLocale(p) }, select: { title: true, price_minor: true, currency: true } } } },
      order: { select: { id: true, status: true, currency: true, locale: true, paid_at: true, items: { select: { unit_price_minor: true, quantity: true } } } },
      messages: { orderBy: { created_at: "asc" } },
    },
  });
  const loc = viewerLocale(p);
  const listing = c.product?.listings[0];
  return {
    id: c.id,
    subject: c.subject,
    status: c.status,
    viewer: p.role,
    seller: c.seller,
    buyer: c.buyer,
    product: c.product
      ? {
          id: c.product.id,
          title: listing?.title ?? c.product.title,
          image_url: c.product.image_url,
          price: listing ? money(listing.price_minor, listing.currency, loc) : null,
        }
      : null,
    order: c.order
      ? {
          id: c.order.id,
          status: c.order.status,
          paid_at: c.order.paid_at?.toISOString() ?? null,
          total: money(c.order.items.reduce((s, i) => s + i.unit_price_minor * i.quantity, 0), c.order.currency, loc),
        }
      : null,
    messages: c.messages.map((m) => ({
      id: m.id,
      from_me: m.sender === p.role,
      sender: m.sender,
      body: m.body,
      body_locale: m.body_locale,
      // A translation exists for the recipient; the sender reads their own words.
      translation: m.sender === p.role ? null : m.translation,
      at: m.created_at.toISOString(),
    })),
  };
}

export async function markRead(p: Principal, id: string) {
  await ownedConversation(p, id);
  await prisma.conversation.update({ where: { id }, data: p.role === "SELLER" ? { seller_unread: 0 } : { buyer_unread: 0 } });
  return { ok: true };
}

export async function sendMessage(p: Principal, id: string, body: string) {
  const c = await ownedConversation(p, id);
  const text = messageBodySchema.parse({ body }).body;
  const at = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversation_id: c.id, sender: p.role, body: text, body_locale: viewerLocale(p), created_at: at },
    }),
    prisma.conversation.update({
      where: { id: c.id },
      data:
        p.role === "SELLER"
          ? { last_message_at: at, status: "OPEN", seller_unread: 0, buyer_unread: { increment: 1 } }
          : { last_message_at: at, status: "OPEN", buyer_unread: 0, seller_unread: { increment: 1 } },
    }),
  ]);
  return { id: message.id, from_me: true, sender: message.sender, body: message.body, body_locale: message.body_locale, translation: null, at: message.created_at.toISOString() };
}

/** "Ask the maker": a buyer opens a thread about a published product. */
export async function startConversation(p: Principal, input: z.infer<typeof startConversationSchema>) {
  if (p.role !== "BUYER") throw new AppError("FORBIDDEN", "Only buyers can start a conversation.");
  const product = await prisma.product.findFirst({
    where: { id: input.product_id, listings: { some: { status: "PUBLISHED" } } },
    select: { id: true, seller_id: true, title: true, listings: { where: { locale: p.market }, select: { title: true } } },
  });
  if (!product) throw notFound("Product");
  const existing = await prisma.conversation.findFirst({
    where: { buyer_id: p.buyerId, seller_id: product.seller_id, product_id: product.id, status: "OPEN" },
    select: { id: true },
  });
  if (existing) {
    await sendMessage(p, existing.id, input.body);
    return { id: existing.id };
  }
  const at = new Date();
  const c = await prisma.conversation.create({
    data: {
      seller_id: product.seller_id,
      buyer_id: p.buyerId,
      product_id: product.id,
      subject: `Question about ${product.listings[0]?.title ?? product.title}`.slice(0, 140),
      last_message_at: at,
      seller_unread: 1,
      messages: { create: { sender: "BUYER", body: input.body, body_locale: p.market, created_at: at } },
    },
  });
  return { id: c.id };
}

export async function unreadCount(p: Principal): Promise<number> {
  const r = await prisma.conversation.aggregate({
    where: ownerWhere(p),
    _sum: { seller_unread: true, buyer_unread: true },
  });
  return (p.role === "SELLER" ? r._sum.seller_unread : r._sum.buyer_unread) ?? 0;
}
