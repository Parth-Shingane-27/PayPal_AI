import { requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listFreelancerApprovals } from "@/server/services/gig/approvals";
import { gigApprovalView } from "@/server/views";

export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  return json({ approvals: (await listFreelancerApprovals(f.freelancerId)).map((a) => gigApprovalView(a, f.locale)) });
});
