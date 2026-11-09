import { requireSeller } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listFindings } from "@/server/proactive/findings";
import { findingView } from "@/server/views";

/** The seller's visible findings; `?agent=TREASURY|OPERATIONS` narrows them to one page. */
export const GET = handler(async (req) => {
  const seller = await requireSeller(req);
  const agent = new URL(req.url).searchParams.get("agent");
  const rows = await listFindings(seller.sellerId, { agent: agent === "TREASURY" || agent === "OPERATIONS" ? agent : undefined });
  return json({ findings: rows.map(findingView) });
});
