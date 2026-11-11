import { z } from "zod";
import { AppError } from "../../errors";
import { saveBrief } from "../../services/gig/briefs";
import { proposeMilestonePlan } from "../../services/gig/contracts";
import { startMilestoneFunding } from "../../services/gig/milestone-payments";
import { requestQuote, viewQuote } from "../../services/gig/quotes";
import { compareServicePages, searchFreelancers } from "../../services/gig/search";
import { clientOf, decimalAmount, ownerOf, uuid } from "../shared-tools";
import { defineTool } from "../tool";

const searchFreelancersTool = defineTool({
  name: "search_freelancers",
  description:
    "Find freelancers for the client's project: semantic search over service pages published in the client's market and over freelancers' skills. Use the client's own words, or a short English paraphrase when that helps (search is multilingual). Returns up to `limit` matches with service_page_id, freelancer_id, freelancer name and country, title, summary, a from-price or hourly rate (with `display`), rating and relevance. Read-only; only services the client can hire in their market.",
  kind: "read",
  input: z.object({ query: z.string().min(1).max(300), limit: z.number().int().min(1).max(12).nullable().describe("How many results (default 6).") }),
  run: (ctx, input) => searchFreelancers(ctx.locale, input.query, input.limit ?? 6),
});

const compareFreelancersTool = defineTool({
  name: "compare_freelancers",
  description:
    "Full facts for 2 to 4 service pages so you can compare the freelancers: description, packages with scope, delivery days, revisions and price, hourly rate, languages, time zone, availability, rating and how many milestones they delivered and had accepted. Compare only on these facts. Read-only.",
  kind: "read",
  input: z.object({ service_page_ids: z.array(uuid()).min(2).max(4) }),
  run: async (ctx, input) => ({ services: await compareServicePages(ctx.locale, input.service_page_ids) }),
});

const draftBriefTool = defineTool({
  name: "draft_brief",
  description:
    "Write or update the client's project brief from what they told you: a short title, a description in their own language with the goal, deliverables, deadline and constraints they gave, skills, an optional budget (decimal in their market currency, only if they gave one) and an optional deadline (YYYY-MM-DD). Pass brief_id to update a brief from this conversation. Saves a DRAFT the client can see; sends it to nobody.",
  kind: "draft",
  input: z.object({
    brief_id: uuid().nullable(),
    title: z.string().min(3).max(140),
    description: z.string().min(10).max(6000),
    skills: z.array(z.string().min(1).max(60)).max(15),
    budget: decimalAmount().nullable(),
    deadline: z.iso.date().nullable(),
  }),
  async run(ctx, input) {
    clientOf(ctx);
    return saveBrief(ownerOf(ctx), { title: input.title, description: input.description, skills: input.skills, budget: input.budget, deadline: input.deadline }, input.brief_id);
  },
});

const requestQuoteTool = defineTool({
  name: "request_quote",
  description:
    "Ask a freelancer for a price for the client's project, about one of their service pages (service_page_id) and optionally with a brief (brief_id). The message is what the freelancer reads, in the client's words. Call it only when the client wants this freelancer to quote. Charges nothing; the freelancer answers with a price later (view_quote shows it).",
  kind: "draft",
  input: z.object({ service_page_id: uuid(), brief_id: uuid().nullable(), message: z.string().min(1).max(4000) }),
  run: (ctx, input) => requestQuote(ownerOf(ctx), { servicePageId: input.service_page_id, briefId: input.brief_id, message: input.message }),
});

const viewQuoteTool = defineTool({
  name: "view_quote",
  description: "Read one of the client's quotes: status (REQUESTED, SENT, ACCEPTED, DECLINED, EXPIRED, WITHDRAWN), the price with `display`, delivery days, revisions, scope and the freelancer's note. Read-only.",
  kind: "read",
  input: z.object({ quote_id: uuid() }),
  run: (ctx, input) => viewQuote(ownerOf(ctx), input.quote_id),
});

const proposeMilestonePlanTool = defineTool({
  name: "propose_milestone_plan",
  description:
    "Split the agreed price into milestones the client pays one at a time. The price comes from a SENT quote (quote_id) or a package of a service page in the client's market (service_page_id + tier); you cannot change it. Give 1-10 milestones with a title, an optional description and either an amount for every milestone (decimal in the price currency) or null for all (code splits evenly). Code checks the milestones add up to the price exactly and returns the plan with each amount's `display`, or an error with the total, the sum and the difference. Saves a DRAFT contract (replacing an earlier unpaid plan for the same quote or package). Charges nothing.",
  kind: "draft",
  input: z.object({
    quote_id: uuid().nullable(),
    service_page_id: uuid().nullable(),
    tier: z.enum(["BASIC", "STANDARD", "PREMIUM"]).nullable(),
    milestones: z
      .array(
        z.object({
          title: z.string().min(1).max(140),
          description: z.string().max(2000).nullable(),
          amount: decimalAmount().nullable(),
          due_in_days: z.number().int().min(1).max(365).nullable(),
        }),
      )
      .min(1)
      .max(10),
  }),
  async run(ctx, input) {
    clientOf(ctx);
    const src = input.quote_id
      ? { quoteId: input.quote_id }
      : input.service_page_id && input.tier
        ? { servicePageId: input.service_page_id, tier: input.tier }
        : null;
    if (!src) throw new AppError("INVALID_INPUT", "Give a quote_id, or a service_page_id with a tier.");
    return proposeMilestonePlan(ownerOf(ctx), src, input.milestones);
  },
});

const createMilestonePaymentTool = defineTool({
  name: "create_milestone_payment",
  description:
    "Start PayPal checkout for the next unfunded milestone of a contract (contract_id from propose_milestone_plan). Call it only when the client says they want to pay. Returns the PayPal order id, the approval link and the amount. This does NOT charge the client: they must approve in the PayPal window, and the money is then held by GlobalGig until they accept the delivery.",
  kind: "draft",
  input: z.object({ contract_id: uuid() }),
  async run(ctx, input) {
    const res = await startMilestoneFunding(ownerOf(ctx), input.contract_id, ctx.audit);
    return {
      ...res,
      charged: false,
      next_step: "The client must open the PayPal window (the PayPal button below the chat, or approve_url) and approve the payment. The money is then held until they accept the delivery.",
    };
  },
});

export const HIRING_TOOLS = [
  searchFreelancersTool,
  compareFreelancersTool,
  draftBriefTool,
  requestQuoteTool,
  viewQuoteTool,
  proposeMilestonePlanTool,
  createMilestonePaymentTool,
];
