import { z } from "zod";
import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { decideCriterion } from "@/server/services/gig/criteria";

/** The client's verdict on one signed criterion after delivery. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const o = gigOwnerOf(await requirePrincipal(req));
  const b = await readBody(req, z.object({ status: z.enum(["PASSED", "FAILED"]), note: z.string().max(500).nullable().default(null) }));
  return json(await decideCriterion(o, await routeId(ctx.params, "Criterion"), b.status, b.note));
});
