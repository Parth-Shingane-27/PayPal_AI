import { z } from "zod";
import { requireFreelancer } from "@/server/auth";
import { notFound } from "@/server/errors";
import { handler, json, readBody, routeId } from "@/server/http";
import { dismissFinding, markSeen, snoozeFinding } from "@/server/proactive/findings";
import { findingView } from "@/server/views";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seen") }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("snooze"), days: z.number().int().min(1).max(30).default(7) }),
]);

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const f = await requireFreelancer(req);
  const id = await routeId(ctx.params, "Finding");
  const b = await readBody(req, body);
  const row = b.action === "seen" ? await markSeen(id, f.freelancerId) : b.action === "dismiss" ? await dismissFinding(id, f.freelancerId) : await snoozeFinding(id, f.freelancerId, b.days);
  if (!row) throw notFound("Finding");
  return json({ finding: findingView(row) });
});
