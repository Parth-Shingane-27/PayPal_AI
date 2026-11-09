import { z } from "zod";
import { MARKET_LOCALES } from "../../domain/markets";
import { detectAnomalies, orderDetails, paymentStatus, queryOrders } from "../../services/insights";
import { earningsByMarket, PERIOD_PRESETS, resolvePeriod } from "../../services/ledger";
import { proposeRefund } from "../../services/refunds";
import { defineTool } from "../tool";
import { decimalAmount, sellerOf, uuid } from "../shared-tools";

const periodFields = {
  period: z.enum(PERIOD_PRESETS).nullable().describe("A named period, or null when from/to are given (default last_30_days)."),
  from: z.iso.date().nullable().describe("Start date YYYY-MM-DD (inclusive), with `to`."),
  to: z.iso.date().nullable().describe("End date YYYY-MM-DD (inclusive), with `from`."),
};

function period(input: { period: (typeof PERIOD_PRESETS)[number] | null; from: string | null; to: string | null }) {
  return resolvePeriod({ preset: input.period ?? undefined, from: input.from ?? undefined, to: input.to ?? undefined });
}

const queryOrdersTool = defineTool({
  name: "query_orders",
  description:
    "List the seller's orders, newest first, optionally filtered by status, market and period (by order date). Returns order_id, date, status, market, buyer, items and total. Read-only.",
  kind: "read",
  input: z.object({
    status: z.enum(["PENDING_PAYMENT", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"]).nullable(),
    market: z.enum(MARKET_LOCALES).nullable(),
    ...periodFields,
    limit: z.number().int().min(1).max(50).nullable(),
  }),
  async run(ctx, input) {
    const p = input.period || input.from || input.to ? period(input) : null;
    return queryOrders(sellerOf(ctx), {
      status: input.status ?? undefined,
      market: input.market ?? undefined,
      from: p?.from,
      to: p?.to,
      limit: input.limit ?? 20,
    });
  },
});

const getOrderDetailsTool = defineTool({
  name: "get_order_details",
  description:
    "Full detail of one order: items, every payment attempt with fees (PayPal, platform, FX) and net, and every refund with its reason, status and amounts. Use it to answer why something happened to an order. Read-only.",
  kind: "read",
  input: z.object({ order_id: uuid() }),
  run: (ctx, input) => orderDetails(sellerOf(ctx), input.order_id, ctx.locale),
});

const getPaymentStatusTool = defineTool({
  name: "get_payment_status",
  description: "Payment state of one order: latest payment status, attempts, captured amount, refunded so far, refunds awaiting approval, and what is still refundable. Read-only.",
  kind: "read",
  input: z.object({ order_id: uuid() }),
  run: (ctx, input) => paymentStatus(sellerOf(ctx), input.order_id, ctx.locale),
});

const earningsByMarketTool = defineTool({
  name: "earnings_by_market",
  description:
    "Captured sales and refunds per market and currency for a period: orders, gross sales, PayPal fees, platform fees, FX costs, net earnings, refund debits and net after refunds, plus totals per currency. Germany is de-DE, Japan ja-JP, India hi-IN, and so on. Quote these figures exactly. Read-only.",
  kind: "read",
  input: z.object({ ...periodFields, market: z.enum(MARKET_LOCALES).nullable() }),
  run: (ctx, input) => earningsByMarket(sellerOf(ctx), period(input), ctx.locale, input.market ?? undefined),
});

const detectAnomaliesTool = defineTool({
  name: "detect_anomalies",
  description:
    "Run the rule-based checks (fee spikes, buyers with repeated refunds, listings with high refund rates, repeated failed payments, failed payouts) and return each finding with evidence. Explain findings in plain language; do not add findings of your own. Read-only.",
  kind: "read",
  input: z.object({}),
  run: (ctx) => detectAnomalies(sellerOf(ctx), ctx.locale),
});

export const proposeRefundTool = defineTool({
  name: "propose_refund",
  description:
    "Propose a refund for an order: amount as a decimal string in the order currency, or null for everything still refundable. Checks what is still refundable (counting other pending proposals) and creates a proposal for the seller to approve. Call it only when the seller asks for a refund. It does NOT refund: nothing reaches the buyer until the seller approves it on the Approvals page.",
  kind: "proposal",
  input: z.object({
    order_id: uuid(),
    amount: decimalAmount().nullable(),
    reason: z.string().min(1).max(500).describe("Reason shown to the buyer by PayPal, in the buyer's language if known."),
    rationale: z.string().min(1).max(1000).describe("Why you propose this, for the seller's approval screen."),
  }),
  run: (ctx, input) =>
    proposeRefund(
      sellerOf(ctx),
      { orderId: input.order_id, amount: input.amount ?? undefined, reason: input.reason, rationale: input.rationale },
      ctx.audit,
      { id: ctx.actionId, tool: "propose_refund", input },
    ),
});

export const OPERATIONS_TOOLS = [queryOrdersTool, getOrderDetailsTool, getPaymentStatusTool, earningsByMarketTool, detectAnomaliesTool, proposeRefundTool];
