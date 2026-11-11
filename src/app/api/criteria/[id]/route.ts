import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { removeCriterion } from "@/server/services/gig/criteria";

/** Removes a criterion nobody has signed yet. */
export const DELETE = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const o = gigOwnerOf(await requirePrincipal(req));
  await removeCriterion(o, await routeId(ctx.params, "Criterion"));
  return json({ ok: true });
});
