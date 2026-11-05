import { getSession, historyOf } from "@/server/agents/sessions";
import { transcriptOf } from "@/server/agents/transcript";
import { requirePrincipal } from "@/server/auth";
import { handler, json, routeId } from "@/server/http";
import { listActivity } from "@/server/services/audit";
import { activityView } from "@/server/views";

/** One conversation: readable transcript plus its activity timeline (and handoff children). */
export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const p = await requirePrincipal(req);
  const id = await routeId(ctx.params, "Conversation");
  const owner = p.role === "SELLER" ? { type: "SELLER" as const, sellerId: p.sellerId } : { type: "BUYER" as const, buyerId: p.buyerId };
  const session = await getSession(id, owner);
  const activity = await listActivity({ sessionIds: [session.id], limit: 200 });
  return json({
    session: { id: session.id, agent: session.agent, locale: session.locale, status: session.status, parent_id: session.parent_id, created_at: session.created_at },
    transcript: transcriptOf(historyOf(session)),
    activity: activity.map(activityView),
  });
});
