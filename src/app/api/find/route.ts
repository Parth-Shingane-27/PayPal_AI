import { requireClient } from "@/server/auth";
import { handler, json } from "@/server/http";
import { compareServicePages, searchFreelancers } from "@/server/services/gig/search";
import { AppError } from "@/server/errors";

/** Client search: ?q=... over services in their market; ?ids=a,b compares service pages. */
export const GET = handler(async (req) => {
  const c = await requireClient(req);
  const url = new URL(req.url);
  const ids = url.searchParams.get("ids");
  if (ids) return json({ services: await compareServicePages(c.market, ids.split(",").slice(0, 4)) });
  const q = url.searchParams.get("q")?.trim();
  if (!q) throw new AppError("INVALID_INPUT", "Type what you need done.");
  return json(await searchFreelancers(c.market, q, 12));
});
