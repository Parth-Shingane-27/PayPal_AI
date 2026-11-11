import { requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listFindings } from "@/server/proactive/findings";
import { findingView } from "@/server/views";

/** Visible findings; ?agent=TREASURY|PROJECTS narrows them to one page. */
export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  const agent = new URL(req.url).searchParams.get("agent");
  const rows = await listFindings(f.freelancerId, { agent: agent === "TREASURY" || agent === "PROJECTS" ? agent : undefined });
  return json({ findings: rows.map(findingView) });
});
