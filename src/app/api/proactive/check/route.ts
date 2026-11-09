import { proactiveEnabled } from "@/server/config";
import { requireSeller } from "@/server/auth";
import { AppError } from "@/server/errors";
import { handler, json } from "@/server/http";
import { enqueueWatch } from "@/server/queue";

/** "Check now": queues a proactive check for the signed-in seller; findings appear when the worker finishes. */
export const POST = handler(async (req) => {
  const seller = await requireSeller(req);
  if (!proactiveEnabled()) throw new AppError("CONFLICT", "Automatic checks are switched off.");
  await enqueueWatch(seller.sellerId, { manual: true });
  return json({ queued: true }, 202);
});
