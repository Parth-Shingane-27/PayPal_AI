import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { prisma } from "@/server/db";
import { handler, json, readBody } from "@/server/http";

export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  const row = await prisma.seller.findUniqueOrThrow({ where: { id: seller.sellerId }, select: { auto_payout_proposals: true } });
  return json({ auto_payout_proposals: row.auto_payout_proposals });
});

/** Opt in or out of Treasury drafting payout proposals by itself. Proposals still wait for approval. */
export const PATCH = handler(async (req) => {
  const seller = await requireSeller(req);
  const b = await readBody(req, z.object({ auto_payout_proposals: z.boolean() }));
  const row = await prisma.seller.update({ where: { id: seller.sellerId }, data: { auto_payout_proposals: b.auto_payout_proposals }, select: { auto_payout_proposals: true } });
  return json({ auto_payout_proposals: row.auto_payout_proposals });
});
