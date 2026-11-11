import { gigOwnerOf, requireClient, requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { cancelDraftContract } from "@/server/services/gig/contracts";
import { contractDetails } from "@/server/services/gig/insights";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  const p = await requirePrincipal(req);
  return json(await contractDetails(gigOwnerOf(p), await routeId(ctx.params, "Contract")));
});

/** The client drops a plan that has nothing paid. */
export const DELETE = handler(async (req, ctx: Ctx) => {
  const c = await requireClient(req);
  return json(await cancelDraftContract(gigOwnerOf(c), await routeId(ctx.params, "Contract")));
});
