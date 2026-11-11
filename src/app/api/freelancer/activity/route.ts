import { requireFreelancer } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listActivity } from "@/server/services/audit";
import { activityView } from "@/server/views";

/** Every tool call, PayPal call, model run and milestone change on the freelancer's account. */
export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 150) || 150, 500);
  return json({ activity: (await listActivity({ freelancerId: f.freelancerId, limit })).map(activityView) });
});
