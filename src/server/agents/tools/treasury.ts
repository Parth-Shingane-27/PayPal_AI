import { z } from "zod";
import { MARKET_LOCALES } from "../../domain/markets";
import { SUPPORTED_CURRENCIES } from "../../domain/money";
import { compareSellingDirect, estimateFeesFor, forecastEarnings } from "../../services/insights";
import { balancesView } from "../../services/ledger";
import { MAX_PAYOUTS_PER_SCHEDULE, proposePayoutSchedule } from "../../services/payouts";
import { defineTool } from "../tool";
import { decimalAmount, sellerOf, uuid } from "./common";

const getBalancesTool = defineTool({
  name: "get_balances",
  description:
    "Get the seller's ledger per currency: earned, refunded, paid out, reserved for scheduled payouts, and available to pay out, each with a `display` string. Call it before any advice about payouts. Read-only.",
  kind: "read",
  input: z.object({}),
  run: (ctx) => balancesView(sellerOf(ctx), ctx.locale),
});

const estimateFeesTool = defineTool({
  name: "estimate_fees",
  description:
    "Estimate the fees on one sale of `amount` (in the market currency) in a market: PayPal fee, international fee, conversion cost, platform fee, net to seller, plus the payout fee and the payout size at which the payout fee hits its cap. All numbers are estimates from the fee table. Read-only.",
  kind: "read",
  input: z.object({ market: z.enum(MARKET_LOCALES), amount: decimalAmount() }),
  run: (ctx, input) => estimateFeesFor(sellerOf(ctx), input),
});

const forecastEarningsTool = defineTool({
  name: "forecast_earnings",
  description:
    "Forecast net earnings per currency for the next horizon_days (default 30) from the trailing 28-day average and its trend. Each forecast carries low_confidence=true when there were fewer than 5 sales; say so when it is true. Read-only.",
  kind: "read",
  input: z.object({
    currency: z.enum(SUPPORTED_CURRENCIES).nullable().describe("Limit to one currency, or null for all."),
    horizon_days: z.number().int().min(1).max(180).nullable(),
  }),
  run: (ctx, input) =>
    forecastEarnings(sellerOf(ctx), { currency: input.currency ?? undefined, horizonDays: input.horizon_days ?? 30 }, ctx.locale),
});

const compareSellingDirectTool = defineTool({
  name: "compare_selling_direct",
  description:
    "Compare one sale on GlobalCart (localized listing, buyer pays in local currency, platform fee, payout fee) with a single-currency direct store in the seller's home currency, using the same fee table. Give a listing_id, or a market and a price. Returns both columns and which nets the seller more. Present both columns honestly, even when GlobalCart costs more. Read-only.",
  kind: "read",
  input: z.object({
    listing_id: uuid().nullable(),
    market: z.enum(MARKET_LOCALES).nullable(),
    price: decimalAmount().nullable().describe("Price in the market currency when no listing_id is given."),
  }),
  run: (ctx, input) =>
    compareSellingDirect(sellerOf(ctx), { listingId: input.listing_id ?? undefined, market: input.market ?? undefined, price: input.price ?? undefined }),
});

const proposePayoutScheduleTool = defineTool({
  name: "propose_payout_schedule",
  description: `Propose a payout schedule for one currency: up to ${MAX_PAYOUTS_PER_SCHEDULE} payouts, each an amount (decimal string, or "ALL_AVAILABLE" for a single payout of everything available after its fee) and a date (YYYY-MM-DD, today or later, within 90 days). Call it only after the seller agreed to the plan. Checks the available balance and returns the proposal with estimated fees. It sends no money: the seller must approve it on the Approvals page, and the balance is checked again then.`,
  kind: "proposal",
  input: z.object({
    currency: z.enum(SUPPORTED_CURRENCIES),
    payouts: z
      .array(
        z.object({
          amount: z.union([decimalAmount(), z.literal("ALL_AVAILABLE")]),
          date: z.iso.date().describe("YYYY-MM-DD"),
        }),
      )
      .min(1)
      .max(MAX_PAYOUTS_PER_SCHEDULE),
    rationale: z.string().min(1).max(1000).describe("Why this schedule, for the seller's approval screen."),
  }),
  run: (ctx, input) =>
    proposePayoutSchedule(sellerOf(ctx), { currency: input.currency, payouts: input.payouts, rationale: input.rationale }, ctx.audit, {
      id: ctx.actionId,
      tool: "propose_payout_schedule",
      input,
    }),
});

export const TREASURY_TOOLS = [getBalancesTool, estimateFeesTool, forecastEarningsTool, compareSellingDirectTool, proposePayoutScheduleTool];
