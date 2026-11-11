import { z } from "zod";
import { gigOwnerOf, requireClient, requirePrincipal } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { listContracts, proposeMilestonePlan } from "@/server/services/gig/contracts";

const STATUS = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"] as const;

export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  const s = new URL(req.url).searchParams.get("status");
  return json({ contracts: await listContracts(gigOwnerOf(p), { status: (STATUS as readonly string[]).includes(s ?? "") ? (s as (typeof STATUS)[number]) : undefined, limit: 200 }) });
});

const milestone = z.object({ title: z.string().min(1).max(140), description: z.string().max(2000).nullable().default(null), amount: z.string().regex(/^\d+(\.\d+)?$/).nullable(), due_in_days: z.number().int().min(1).max(365).nullable().default(null) });

/** A client's milestone plan on a sent quote or a package; saved as a DRAFT contract, nothing charged. */
export const POST = handler(async (req) => {
  const c = await requireClient(req);
  const b = await readBody(
    req,
    z.union([
      z.object({ quote_id: z.uuid(), milestones: z.array(milestone).min(1).max(10) }),
      z.object({ service_page_id: z.uuid(), tier: z.enum(["BASIC", "STANDARD", "PREMIUM"]), milestones: z.array(milestone).min(1).max(10) }),
    ]),
  );
  const src = "quote_id" in b ? { quoteId: b.quote_id } : { servicePageId: b.service_page_id, tier: b.tier };
  return json(await proposeMilestonePlan(gigOwnerOf(c), src, b.milestones), 201);
});
