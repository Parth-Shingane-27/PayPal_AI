import { z } from "zod";
import { requireFreelancer } from "@/server/auth";
import { SUPPORTED_CURRENCIES } from "@/server/domain/money";
import { handler, json, readBody } from "@/server/http";
import { payOutNowFreelancer } from "@/server/services/gig/approvals";

/** "Pay out now": everything available (released, never in holding) in one currency. The click is the approval. */
export const POST = handler(async (req) => {
  const f = await requireFreelancer(req);
  const body = await readBody(req, z.object({ currency: z.enum(SUPPORTED_CURRENCIES) }));
  return json(await payOutNowFreelancer(f.freelancerId, body.currency));
});
