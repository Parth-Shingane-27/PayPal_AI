import { z } from "zod";
import { gigOwnerOf, requireClient, requirePrincipal } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { listQuotes, requestQuote } from "@/server/services/gig/quotes";

const STATUSES = ["REQUESTED", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"] as const;

/** The signed-in freelancer's or client's quotes; ?status= narrows them. */
export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  const s = new URL(req.url).searchParams.get("status");
  return json({ quotes: await listQuotes(gigOwnerOf(p), { status: (STATUSES as readonly string[]).includes(s ?? "") ? (s as (typeof STATUSES)[number]) : undefined }) });
});

/** A client asks for a price. */
export const POST = handler(async (req) => {
  const c = await requireClient(req);
  const b = await readBody(req, z.object({ service_page_id: z.uuid(), brief_id: z.uuid().nullable().default(null), message: z.string().min(1).max(4000) }));
  return json(await requestQuote(gigOwnerOf(c), { servicePageId: b.service_page_id, briefId: b.brief_id, message: b.message }), 201);
});
