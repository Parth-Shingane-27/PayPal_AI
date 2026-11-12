import { z } from "zod";
import { gigOwnerOf, requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listOpenBriefs } from "@/server/services/gig/briefs";

const query = z.object({
  q: z.string().trim().max(120).optional(),
  skill: z.string().trim().max(60).optional(),
  language: z.string().trim().min(2).max(5).optional(),
});

/** The project board: open projects, best skill match first. */
export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  const sp = new URL(req.url).searchParams;
  const p = query.parse({ q: sp.get("q") ?? undefined, skill: sp.get("skill") ?? undefined, language: sp.get("language") ?? undefined });
  return json({ projects: await listOpenBriefs(gigOwnerOf(f), { q: p.q, skills: p.skill ? [p.skill] : undefined, language: p.language }) });
});
