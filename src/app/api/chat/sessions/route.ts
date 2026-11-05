import { z } from "zod";
import { listSessions } from "@/server/agents/sessions";
import { requirePrincipal } from "@/server/auth";
import { handler, json } from "@/server/http";

const agentSchema = z.enum(["LISTING", "SHOPPING", "TREASURY", "OPERATIONS"]).optional();

export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  const agent = agentSchema.parse(new URL(req.url).searchParams.get("agent") ?? undefined);
  const owner = p.role === "SELLER" ? { type: "SELLER" as const, sellerId: p.sellerId } : { type: "BUYER" as const, buyerId: p.buyerId };
  return json({ sessions: await listSessions(owner, agent) });
});
