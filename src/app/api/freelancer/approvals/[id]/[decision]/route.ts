import { requireFreelancer } from "@/server/auth";
import { AppError } from "@/server/errors";
import { handler, json, routeId } from "@/server/http";
import { approveFreelancerAction, rejectFreelancerAction } from "@/server/services/gig/approvals";

/** The freelancer's click on a proposal. No agent tool can reach this route. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string; decision: string }> }) => {
  const f = await requireFreelancer(req);
  const id = await routeId(ctx.params, "Approval");
  const { decision } = await ctx.params;
  if (decision === "approve") return json(await approveFreelancerAction(id, f.freelancerId));
  if (decision === "reject") return json(await rejectFreelancerAction(id, f.freelancerId));
  throw new AppError("NOT_FOUND", "Unknown decision.");
});
