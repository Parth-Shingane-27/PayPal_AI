import { z } from "zod";
import { MARKET_LOCALES } from "../../domain/markets";
import { SUPPORTED_CURRENCIES } from "../../domain/money";
import { AppError } from "../../errors";
import { compareDirectInvoicing, estimateMilestoneFees, forecastFreelancerEarnings } from "../../services/gig/insights";
import { getInvoice, getInvoiceByNumber, getInvoiceForMilestone } from "../../services/gig/invoices";
import { freelancerBalancesView } from "../../services/gig/ledger";
import { proposeFreelancerPayoutSchedule } from "../../services/gig/payouts";
import { MAX_PAYOUTS_PER_SCHEDULE } from "../../domain/fees";
import { decimalAmount, freelancerOf, ownerOf, uuid } from "../shared-tools";
import { defineTool } from "../tool";

const getBalancesTool = defineTool({
  name: "get_balances",
  description:
    "Get the freelancer's money per currency: available (released and not yet paid out: the only money that can be paid out), in_holding (funded by clients but not accepted yet), released, refunded, paid out and reserved for scheduled payouts, each with a `display` string. Call it before any advice about payouts or 'how much do I have'. Read-only.",
  kind: "read",
  input: z.object({}),
  run: (ctx) => freelancerBalancesView(freelancerOf(ctx), ctx.locale),
});

const estimateFeesTool = defineTool({
  name: "estimate_fees",
  description:
    "Estimate the fees on one milestone of `amount` (in the market currency) paid by a client in a market: PayPal fee, international fee, conversion cost, platform fee and net to the freelancer, plus the payout fee and the payout size where it hits its cap. All estimates from the fee table. Read-only.",
  kind: "read",
  input: z.object({ market: z.enum(MARKET_LOCALES), amount: decimalAmount() }),
  run: (ctx, input) => estimateMilestoneFees(freelancerOf(ctx), input),
});

const forecastTool = defineTool({
  name: "forecast_earnings",
  description:
    "Forecast what contracted work should release over the next horizon_days (default 30), per currency, net of estimated fees: money already in holding plus unfunded milestones due in the horizon, with disputed money shown separately and the last 28 days of released money for comparison. low_confidence=true means most of it is not funded yet; say so. Read-only.",
  kind: "read",
  input: z.object({ currency: z.enum(SUPPORTED_CURRENCIES).nullable(), horizon_days: z.number().int().min(1).max(180).nullable() }),
  run: (ctx, input) => forecastFreelancerEarnings(freelancerOf(ctx), { currency: input.currency ?? undefined, horizonDays: input.horizon_days ?? 30 }, ctx.locale),
});

const compareDirectTool = defineTool({
  name: "compare_direct_invoicing",
  description:
    "Compare one milestone through GlobalGig (client pays in their currency, money held until they accept, platform fee, payout fee) with invoicing the client directly through PayPal in the freelancer's home currency (no platform fee, no holding). Give a milestone_id, or a market and an amount. Returns both columns and which nets more. Present both honestly, even when GlobalGig costs more, and say what each side includes. Read-only.",
  kind: "read",
  input: z.object({ milestone_id: uuid().nullable(), market: z.enum(MARKET_LOCALES).nullable(), amount: decimalAmount().nullable() }),
  run: (ctx, input) => compareDirectInvoicing(freelancerOf(ctx), { milestoneId: input.milestone_id ?? undefined, market: input.market ?? undefined, amount: input.amount ?? undefined }),
});

const proposePayoutScheduleTool = defineTool({
  name: "propose_payout_schedule",
  description: `Propose a payout schedule for one currency: up to ${MAX_PAYOUTS_PER_SCHEDULE} payouts, each an amount (decimal, or "ALL_AVAILABLE" for one payout of everything available after its fee) and a date (YYYY-MM-DD, today or later, within 90 days). Only released money can be paid out; money in holding cannot. Call it only after the freelancer agreed. It sends no money: the freelancer must approve it on the Approvals page, and the balance is checked again then.`,
  kind: "proposal",
  input: z.object({
    currency: z.enum(SUPPORTED_CURRENCIES),
    payouts: z.array(z.object({ amount: z.union([decimalAmount(), z.literal("ALL_AVAILABLE")]), date: z.iso.date() })).min(1).max(MAX_PAYOUTS_PER_SCHEDULE),
    rationale: z.string().min(1).max(1000).describe("Why this schedule, for the approval screen."),
  }),
  run: (ctx, input) =>
    proposeFreelancerPayoutSchedule(freelancerOf(ctx), { currency: input.currency, payouts: input.payouts, rationale: input.rationale }, ctx.audit, { id: ctx.actionId, tool: "propose_payout_schedule", input }),
});

const getInvoiceTool = defineTool({
  name: "get_invoice",
  description:
    "Read one invoice by invoice_id, by number (e.g. GG-PRK-000042) or by the milestone it was issued for: number, date, client details and the tax ID exactly as the client entered it, line items and total with `display`. Invoices are issued automatically for each released milestone, in the client's currency and language; no tax is calculated. Read-only.",
  kind: "read",
  input: z.object({ invoice_id: uuid().nullable(), number: z.string().max(40).nullable(), milestone_id: uuid().nullable() }),
  async run(ctx, input) {
    const o = ownerOf(ctx);
    if (input.invoice_id) return getInvoice(o, input.invoice_id);
    if (input.number) return getInvoiceByNumber(o, input.number);
    if (input.milestone_id) return getInvoiceForMilestone(o, input.milestone_id);
    throw new AppError("INVALID_INPUT", "Give an invoice_id, an invoice number or a milestone_id.");
  },
});

export const TREASURY_TOOLS = [getBalancesTool, estimateFeesTool, forecastTool, compareDirectTool, proposePayoutScheduleTool, getInvoiceTool];
