import { z } from "zod";
import { gigOwnerOf, requireClient, requirePrincipal } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { listThreads, startThread, threadUnreadCount } from "@/server/services/gig/threads";

export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  const o = gigOwnerOf(p);
  if (new URL(req.url).searchParams.get("count") === "unread") return json({ unread: await threadUnreadCount(o) });
  return json({ threads: await listThreads(o) });
});

/** A client asks a freelancer about a service ("Ask the freelancer"). */
export const POST = handler(async (req) => {
  const c = await requireClient(req);
  const b = await readBody(req, z.object({ service_page_id: z.uuid(), body: z.string().min(1).max(4000) }));
  return json(await startThread(gigOwnerOf(c), { servicePageId: b.service_page_id, body: b.body }), 201);
});
