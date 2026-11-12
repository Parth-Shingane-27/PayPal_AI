import { z } from "zod";
import { listSessions } from "@/server/agents/sessions";
import { requireChatOwner } from "@/server/auth";
import { handler, json } from "@/server/http";

const agentSchema = z.enum(["PROFILE", "HIRING"]).optional();

export const GET = handler(async (req) => {
  const { owner } = await requireChatOwner(req);
  const agent = agentSchema.parse(new URL(req.url).searchParams.get("agent") ?? undefined);
  return json({ sessions: await listSessions(owner, agent) });
});
