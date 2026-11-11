import { requireClient, gigOwnerOf } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { briefInputSchema, listBriefs, saveBrief } from "@/server/services/gig/briefs";

export const GET = handler(async (req) => {
  const c = await requireClient(req);
  return json({ briefs: await listBriefs(gigOwnerOf(c)) });
});

export const POST = handler(async (req) => {
  const c = await requireClient(req);
  return json(await saveBrief(gigOwnerOf(c), await readBody(req, briefInputSchema)), 201);
});
