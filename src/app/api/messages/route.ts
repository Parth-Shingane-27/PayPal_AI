import { requirePrincipal } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { listConversations, startConversation, startConversationSchema } from "@/server/services/messages";

/** Threads for the signed-in seller or buyer, newest first. */
export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  return json({ conversations: await listConversations(p) });
});

/** Buyer starts (or continues) a thread about a product. */
export const POST = handler(async (req) => {
  const p = await requirePrincipal(req);
  const input = await readBody(req, startConversationSchema);
  return json(await startConversation(p, input), 201);
});
