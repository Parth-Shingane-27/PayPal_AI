import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listQuotes } from "@/server/services/gig/quotes";

const STATUSES = ["SENT", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"] as const;

/** The signed-in freelancer's or client's proposals; ?status= narrows them. */
export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  const s = new URL(req.url).searchParams.get("status");
  return json({ quotes: await listQuotes(gigOwnerOf(p), { status: (STATUSES as readonly string[]).includes(s ?? "") ? (s as (typeof STATUSES)[number]) : undefined }) });
});
