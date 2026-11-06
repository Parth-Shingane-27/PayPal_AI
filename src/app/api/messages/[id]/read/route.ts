import { requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { markRead } from "@/server/services/messages";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const p = await requirePrincipal(req);
  return json(await markRead(p, await routeId(ctx.params, "Conversation")));
});
