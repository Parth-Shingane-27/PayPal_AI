import { gigOwnerOf, requireClient, requireFreelancer } from "@/server/auth";
import { handler, json, readBody, routeId } from "@/server/http";
import { listProposals, sendProposal, sendQuoteSchema } from "@/server/services/gig/quotes";

type Ctx = { params: Promise<{ id: string }> };

/** The client sees every proposal on their project. */
export const GET = handler(async (req, ctx: Ctx) => {
  const c = await requireClient(req);
  return json({ proposals: await listProposals(gigOwnerOf(c), await routeId(ctx.params, "Project")) });
});

/** A freelancer sends (or revises) a proposal on an open project. */
export const POST = handler(async (req, ctx: Ctx) => {
  const f = await requireFreelancer(req);
  const id = await routeId(ctx.params, "Project");
  const out = await sendProposal(gigOwnerOf(f), id, await readBody(req, sendQuoteSchema));
  return json(out, out.revised ? 200 : 201);
});
