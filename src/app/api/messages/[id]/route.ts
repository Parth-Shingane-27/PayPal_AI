import { requirePrincipal } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { getConversation, messageBodySchema, sendMessage } from "@/server/services/messages";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  const p = await requirePrincipal(req);
  return json(await getConversation(p, await routeId(ctx.params, "Conversation")));
});

/** Reply in a thread. */
export const POST = handler(async (req, ctx: Ctx) => {
  const p = await requirePrincipal(req);
  const id = await routeId(ctx.params, "Conversation");
  const { body } = await readBody(req, messageBodySchema);
  return json(await sendMessage(p, id, body), 201);
});
