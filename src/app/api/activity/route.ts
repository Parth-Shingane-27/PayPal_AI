import { listSessions } from "@/server/agents/sessions";
import { requirePrincipal } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listActivity } from "@/server/services/audit";
import { activityView } from "@/server/views";

/** Timeline of tool calls, PayPal calls and model runs, scoped to the signed-in actor. */
export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 150) || 150, 500);
  const rows =
    p.role === "SELLER"
      ? await listActivity({ sellerId: p.sellerId, limit })
      : await listActivity({ sessionIds: (await listSessions({ type: "BUYER", buyerId: p.buyerId })).map((s) => s.id), limit });
  return json({ activity: rows.map(activityView) });
});
