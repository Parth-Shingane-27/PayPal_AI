import { z } from "zod";
import { requireFreelancer } from "@/server/auth";
import { prisma } from "@/server/db";
import { handler, json, readBody } from "@/server/http";

/** Opt in or out of Treasury drafting payout proposals on its own (still approved by the freelancer). */
export const POST = handler(async (req) => {
  const f = await requireFreelancer(req);
  const b = await readBody(req, z.object({ auto_payout_proposals: z.boolean() }));
  await prisma.freelancer.update({ where: { id: f.freelancerId }, data: { auto_payout_proposals: b.auto_payout_proposals } });
  return json({ auto_payout_proposals: b.auto_payout_proposals });
});
