import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { threadForContract } from "@/server/services/gig/threads";

/** The project thread for a contract, opened on first use. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const p = await requirePrincipal(req);
  const t = await threadForContract(gigOwnerOf(p), await routeId(ctx.params, "Contract"));
  return json({ thread_id: t.id });
});
