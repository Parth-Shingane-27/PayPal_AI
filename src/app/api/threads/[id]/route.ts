import { z } from "zod";
import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { getThread, markThreadRead, sendThreadMessage } from "@/server/services/gig/threads";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  const p = await requirePrincipal(req);
  const o = gigOwnerOf(p);
  const id = await routeId(ctx.params, "Conversation");
  const thread = await getThread(o, id);
  await markThreadRead(o, id);
  return json(thread);
});

export const POST = handler(async (req, ctx: Ctx) => {
  const p = await requirePrincipal(req);
  const b = await readBody(req, z.object({ body: z.string().max(4000), attachment_ids: z.array(z.uuid()).max(20).default([]) }));
  return json(await sendThreadMessage(gigOwnerOf(p), await routeId(ctx.params, "Conversation"), b.body, b.attachment_ids), 201);
});
