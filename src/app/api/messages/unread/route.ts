import { requirePrincipal } from "@/server/auth";
import { handler, json } from "@/server/http";
import { unreadCount } from "@/server/services/messages";

export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  return json({ unread: await unreadCount(p) });
});
