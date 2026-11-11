import { requireFreelancer } from "@/server/auth";
import { proactiveEnabled } from "@/server/config";
import { AppError } from "@/server/errors";
import { handler, json } from "@/server/http";
import { enqueueWatch } from "@/server/queue";

/** "Check now": queues a proactive check; findings appear when the worker finishes. */
export const POST = handler(async (req) => {
  const f = await requireFreelancer(req);
  if (!proactiveEnabled()) throw new AppError("CONFLICT", "Automatic checks are switched off.");
  await enqueueWatch(f.freelancerId, { manual: true });
  return json({ queued: true }, 202);
});
