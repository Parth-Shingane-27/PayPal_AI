import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { signCriteria } from "@/server/services/gig/criteria";

/** The caller's signature on every criterion of the milestone. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const o = gigOwnerOf(await requirePrincipal(req));
  return json({ criteria: await signCriteria(o, await routeId(ctx.params, "Milestone")) });
});
