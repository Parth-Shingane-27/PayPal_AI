import { z } from "zod";
import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { CRITERIA_MAX, CRITERION_TEXT_MAX } from "@/server/domain/criteria";
import { handler, json, readBody, routeId } from "@/server/http";
import { addCriteria, listCriteria } from "@/server/services/gig/criteria";

/** Acceptance criteria of a milestone: read them, or add some (either side, before work starts). */
export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const o = gigOwnerOf(await requirePrincipal(req));
  return json({ criteria: await listCriteria(o, await routeId(ctx.params, "Milestone")) });
});

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const o = gigOwnerOf(await requirePrincipal(req));
  const b = await readBody(req, z.object({ texts: z.array(z.string().max(CRITERION_TEXT_MAX)).min(1).max(CRITERIA_MAX) }));
  return json({ criteria: await addCriteria(o, await routeId(ctx.params, "Milestone"), b.texts) });
});
