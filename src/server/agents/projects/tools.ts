import { z } from "zod";
import { MARKET_LOCALES } from "../../domain/markets";
import { contractDetails, deliveryNoteFacts, detectFreelancerAnomalies, earningsBy, milestoneStatus, queryContracts } from "../../services/gig/insights";
import { proposeMilestoneRefund } from "../../services/gig/refunds";
import { PERIOD_PRESETS, resolvePeriod } from "../../domain/period";
import { decimalAmount, freelancerOf, ownerOf, uuid } from "../shared-tools";
import { defineTool } from "../tool";

const MILESTONE_STATES = ["AWAITING_FUNDING", "FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "ACCEPTED", "DISPUTED", "REFUNDED", "CANCELLED"] as const;

const queryContractsTool = defineTool({
  name: "query_contracts",
  description:
    "List the freelancer's contracts, newest activity first: title, client, market, total, money in holding, released and awaiting funding, and each milestone's state and amount. Filter by contract status, by a milestone state (contracts with at least one milestone in it) or by client name. Read-only.",
  kind: "read",
  input: z.object({
    status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]).nullable(),
    milestone_state: z.enum(MILESTONE_STATES).nullable(),
    client_name: z.string().max(100).nullable(),
    limit: z.number().int().min(1).max(50).nullable(),
  }),
  run: (ctx, input) => {
    freelancerOf(ctx);
    return queryContracts(ownerOf(ctx), { status: input.status ?? undefined, milestoneState: input.milestone_state ?? undefined, clientName: input.client_name ?? undefined, limit: input.limit ?? 20 });
  },
});

const contractDetailsTool = defineTool({
  name: "get_contract_details",
  description: "Everything about one contract: scope, milestones, every payment with fees (estimates flagged) and net, refunds and why, invoices, and the project thread size. Use it to explain what happened on a project. Read-only.",
  kind: "read",
  input: z.object({ contract_id: uuid() }),
  run: (ctx, input) => {
    freelancerOf(ctx);
    return contractDetails(ownerOf(ctx), input.contract_id);
  },
});

const milestoneStatusTool = defineTool({
  name: "get_milestone_status",
  description:
    "One milestone: its state and history (who did what, with notes), where the money is (not funded, in holding, released, refunded), the auto-release countdown, deliverables, what was refunded and what is still refundable. Read-only.",
  kind: "read",
  input: z.object({ milestone_id: uuid() }),
  run: (ctx, input) => {
    freelancerOf(ctx);
    return milestoneStatus(ownerOf(ctx), input.milestone_id);
  },
});

const periodInput = {
  preset: z.enum(PERIOD_PRESETS).nullable().describe("A named period, or null to use from/to (default last_30_days)."),
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
};
const period = (input: { preset: (typeof PERIOD_PRESETS)[number] | null; from: string | null; to: string | null }) =>
  resolvePeriod({ preset: input.preset ?? undefined, from: input.from ?? undefined, to: input.to ?? undefined });

const earningsByClientTool = defineTool({
  name: "earnings_by_client",
  description: "Money released in a period, per client and currency: milestones released, gross, fees, net released, refund debits and net after refunds, each with `display`. Optional client name filter. Read-only.",
  kind: "read",
  input: z.object({ ...periodInput, client_name: z.string().max(100).nullable() }),
  run: (ctx, input) => earningsBy(freelancerOf(ctx), "client", period(input), ctx.locale, input.client_name ?? undefined),
});

const earningsByMarketTool = defineTool({
  name: "earnings_by_market",
  description: "Money released in a period, per client market (de-DE, ja-JP, ...) and currency, with the same figures as earnings_by_client. Optional market filter. Read-only.",
  kind: "read",
  input: z.object({ ...periodInput, market: z.enum(MARKET_LOCALES).nullable() }),
  run: (ctx, input) => earningsBy(freelancerOf(ctx), "market", period(input), ctx.locale, input.market ?? undefined),
});

const detectAnomaliesTool = defineTool({
  name: "detect_anomalies",
  description: "Run the anomaly rules over the freelancer's projects (fee spikes, revision loops, open disputes, repeat refunds, failed payments, failed payouts). Returns the rules checked and each finding with its evidence. Read-only.",
  kind: "read",
  input: z.object({}),
  run: (ctx) => detectFreelancerAnomalies(freelancerOf(ctx), ctx.locale),
});

export const proposeRefundTool = defineTool({
  name: "propose_refund",
  description:
    "Propose refunding a client for a milestone, in full (amount null) or in part (decimal in the milestone currency). Before the client accepts, only a full refund is possible unless the milestone is disputed (then a partial refund releases the rest to the freelancer). After release it is debited from the freelancer's balance. Call it only when the freelancer asks for a refund. It moves no money: the freelancer approves it on the Approvals page.",
  kind: "proposal",
  input: z.object({
    milestone_id: uuid(),
    amount: decimalAmount().nullable(),
    reason: z.string().min(1).max(500).describe("Shown to the client with the refund."),
    rationale: z.string().min(1).max(1000).describe("Why, for the approval screen."),
  }),
  run: (ctx, input) =>
    proposeMilestoneRefund(
      freelancerOf(ctx),
      { milestoneId: input.milestone_id, amount: input.amount ?? undefined, reason: input.reason, rationale: input.rationale },
      ctx.audit,
      { id: ctx.actionId, tool: "propose_refund", input },
    ),
});

const draftDeliveryNoteTool = defineTool({
  name: "draft_delivery_note",
  description:
    "Facts for writing a delivery note for one milestone: the client's language, the agreed scope, deliverables attached, earlier revision requests and how many revisions are left. Write the note yourself, in the client's language, for the freelancer to paste into the project thread when they click Deliver. Sends nothing and changes nothing.",
  kind: "read",
  input: z.object({ milestone_id: uuid() }),
  run: (ctx, input) => deliveryNoteFacts(freelancerOf(ctx), input.milestone_id),
});

export const PROJECTS_TOOLS = [
  queryContractsTool,
  contractDetailsTool,
  milestoneStatusTool,
  earningsByClientTool,
  earningsByMarketTool,
  detectAnomaliesTool,
  proposeRefundTool,
  draftDeliveryNoteTool,
];
