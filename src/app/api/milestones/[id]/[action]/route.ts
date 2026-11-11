import { z } from "zod";
import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { AppError } from "@/server/errors";
import { handler, json, readBody, routeId } from "@/server/http";
import { acceptDelivery, cancelMilestone, deliverMilestone, milestoneView, openDispute, requestRevision, startMilestone } from "@/server/services/gig/milestones";

const note = z.object({ note: z.string().max(2000).nullable().default(null), attachment_ids: z.array(z.uuid()).max(20).default([]) });

/**
 * Milestone buttons. Freelancer: start, deliver. Client: accept (releases the
 * money), revision, dispute. Either: cancel an unfunded milestone. The state
 * machine refuses anything else, including a freelancer accepting.
 */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const p = await requirePrincipal(req);
  const o = gigOwnerOf(p);
  const { action } = await ctx.params;
  const id = await routeId(ctx.params, "Milestone");
  switch (action) {
    case "start":
      return json(milestoneView(await startMilestone(o, id), o.locale));
    case "deliver": {
      const b = await readBody(req, note);
      return json(milestoneView(await deliverMilestone(o, id, { note: b.note, attachmentIds: b.attachment_ids }), o.locale));
    }
    case "accept": {
      const r = await acceptDelivery(o, id);
      return json({ ...milestoneView(r.milestone, o.locale), released: true });
    }
    case "revision": {
      const b = await readBody(req, note);
      return json(milestoneView(await requestRevision(o, id, b.note ?? ""), o.locale));
    }
    case "dispute": {
      const b = await readBody(req, note);
      return json(milestoneView(await openDispute(o, id, b.note ?? ""), o.locale));
    }
    case "cancel":
      return json(milestoneView(await cancelMilestone(o, id), o.locale));
    default:
      throw new AppError("NOT_FOUND", "Unknown milestone action.");
  }
});
