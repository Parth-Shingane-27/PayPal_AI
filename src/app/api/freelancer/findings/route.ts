import { requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listFindings } from "@/server/proactive/findings";
import { findingView } from "@/server/views";

/** The freelancer's visible findings. */
export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  const rows = await listFindings(f.freelancerId);
  return json({ findings: rows.map(findingView) });
});
