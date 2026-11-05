import type { AgentName } from "@/generated/prisma/client";
import { prisma } from "../db";
import type { Market } from "../domain/markets";
import { notFound } from "../errors";
import type { SessionOwner } from "./sessions";

/**
 * The session_context block sent as the first text block of a conversation's
 * first user turn. It carries the per-conversation facts that must stay out
 * of the cached system prompt. It comes from the session, never from the user.
 */
export async function buildContext(
  owner: SessionOwner,
  market: Market,
  opts: { productId?: string | null; handoff?: { from: AgentName; summary: string }; today?: Date } = {},
): Promise<string> {
  const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const lines = [`Today (UTC): ${today}`];

  if (owner.type === "SELLER") {
    const seller = await prisma.seller.findUnique({ where: { id: owner.sellerId } });
    if (!seller) throw notFound("Seller");
    lines.push(
      `User: seller "${seller.name}" (home country ${seller.country}, home currency ${seller.currency})`,
      `Seller locale: ${market.locale}; reply language: ${market.language}`,
    );
    if (opts.productId) {
      const product = await prisma.product.findFirst({ where: { id: opts.productId, seller_id: seller.id } });
      if (!product) throw notFound("Product");
      lines.push(`The seller opened this chat from the editor of product ${product.id} ("${product.title}").`);
    }
  } else {
    lines.push(
      "User: a buyer",
      `Buyer market: ${market.locale} (${market.country}); prices are in ${market.currency}; reply language: ${market.language}`,
    );
  }
  if (opts.handoff) {
    lines.push(`This conversation was handed over by the ${opts.handoff.from.toLowerCase()} assistant. Its summary: ${opts.handoff.summary}`);
  }
  return `<session_context>\nWritten by GlobalCart, not by the user.\n${lines.join("\n")}\n</session_context>`;
}
