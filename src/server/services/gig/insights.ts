import { coreConfig } from "../../config";
import { prisma } from "../../db";
import { ESTIMATE_NOTE, estimatePayoutFee, estimateSaleFees, FEE_TABLE, payoutFeeCapThreshold, type SaleContext } from "../../domain/fees";
import { getMarket, isMarketLocale } from "../../domain/markets";
import { type Currency, money, parseDecimal } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { getContract } from "./contracts";
import { getMilestone } from "./milestones";
import type { GigOwner } from "./owner";

/**
 * Read-only numbers for the Freelancer Agent and the contract pages. Every figure is
 * computed here from the ledger tables and the fee estimate table; agents
 * only quote the `display` strings.
 */


async function freelancer(freelancerId: string) {
  const f = await prisma.freelancer.findUnique({ where: { id: freelancerId } });
  if (!f) throw notFound("Freelancer");
  return f;
}

function saleContext(f: { country: string; currency: string }, locale: string): SaleContext {
  const mk = getMarket(locale);
  return { currency: mk.currency, marketCountry: mk.country, freelancerCountry: f.country, freelancerCurrency: f.currency, platformBps: coreConfig().PLATFORM_FEE_BPS };
}

function feeView(fees: ReturnType<typeof estimateSaleFees>, currency: string, locale: string) {
  const m = (minor: number) => money(minor, currency, locale);
  return {
    paypal_fee: m(fees.paypal_fee),
    international_fee: m(fees.international_fee),
    conversion_cost: m(fees.conversion_cost),
    platform_fee: m(fees.platform_fee),
    total_fees: m(fees.total_fees),
    net_to_freelancer: m(fees.net_to_freelancer),
  };
}

// --- Treasury -------------------------------------------------------------------

/** estimate_fees: one milestone of `amount` paid by a client in `market`. */
export async function estimateMilestoneFees(freelancerId: string, input: { market: string; amount: string }) {
  if (!isMarketLocale(input.market)) throw new AppError("INVALID_INPUT", `Unknown market ${input.market}.`);
  const f = await freelancer(freelancerId);
  const mk = getMarket(input.market);
  const gross = parseDecimal(input.amount, mk.currency);
  if (gross <= 0) throw new AppError("INVALID_INPUT", "Amount must be positive.");
  const ctx = saleContext(f, input.market);
  const fees = estimateSaleFees(gross, ctx);
  const m = (minor: number) => money(minor, mk.currency, mk.locale);
  return {
    market: input.market,
    milestone_amount: m(gross),
    international: ctx.marketCountry !== ctx.freelancerCountry,
    currency_conversion: ctx.currency !== ctx.freelancerCurrency,
    fees: feeView(fees, mk.currency, mk.locale),
    payout_fee_if_paid_out_alone: m(estimatePayoutFee(fees.net_to_freelancer, mk.currency)),
    payout_fee_cap: m(FEE_TABLE.payout_fee_cap_minor[mk.currency as Currency]),
    payout_size_where_fee_hits_cap: m(payoutFeeCapThreshold(mk.currency)),
    when_you_get_it: "Fees are taken when the client funds the milestone; the net becomes available to pay out when the client accepts the delivery (or it auto-releases).",
    fees_are_estimates: true,
    note: ESTIMATE_NOTE,
  };
}

export async function contractDetails(o: GigOwner, contractId: string) {
  const c = await getContract(o, contractId);
  const [payments, refunds, invoices, thread] = await Promise.all([
    prisma.milestonePayment.findMany({ where: { contract_id: contractId }, orderBy: { created_at: "asc" } }),
    prisma.milestoneRefund.findMany({ where: { contract_id: contractId }, orderBy: { created_at: "asc" } }),
    prisma.invoice.findMany({ where: { contract_id: contractId }, orderBy: { seq: "asc" }, select: { id: true, number: true, milestone_id: true } }),
    prisma.thread.findFirst({ where: { contract_id: contractId }, select: { id: true, _count: { select: { messages: true } } } }),
  ]);
  const m = (minor: number, cur: string) => money(minor, cur, o.locale);
  return {
    ...c,
    payments: payments.map((p) => ({
      milestone_id: p.milestone_id,
      status: p.status,
      gross: m(p.gross_minor, p.currency),
      paypal_fee: p.paypal_fee_minor === null ? null : m(p.paypal_fee_minor, p.currency),
      platform_fee: p.platform_fee_minor === null ? null : m(p.platform_fee_minor, p.currency),
      fx_cost: p.fx_cost_minor === null ? null : m(p.fx_cost_minor, p.currency),
      fees_are_estimates: p.fee_is_estimate,
      net_to_freelancer: p.net_to_freelancer_minor === null ? null : m(p.net_to_freelancer_minor, p.currency),
      captured_at: p.captured_at?.toISOString() ?? null,
      released_at: p.released_at?.toISOString() ?? null,
      failure_reason: p.failure_reason,
    })),
    refunds: refunds.map((r) => ({
      refund_id: r.id,
      milestone_id: r.milestone_id,
      amount: m(r.amount_minor, r.currency),
      status: r.status,
      reason: r.reason,
      from_holding: r.from_holding,
      freelancer_debit: r.freelancer_debit_minor === null ? null : m(r.freelancer_debit_minor, r.currency),
      at: (r.completed_at ?? r.created_at).toISOString(),
    })),
    invoices: invoices.map((i) => ({ invoice_id: i.id, number: i.number, milestone_id: i.milestone_id })),
    thread: thread ? { thread_id: thread.id, messages: thread._count.messages } : null,
  };
}

/** get_milestone_status: state, history, money and what can still be refunded. */
export async function milestoneStatus(o: GigOwner, milestoneId: string, now = new Date()) {
  const m = await getMilestone(o, milestoneId);
  const payment = await prisma.milestonePayment.findFirst({ where: { milestone_id: milestoneId, status: "COMPLETED" }, include: { refunds: { where: { status: { in: ["PROPOSED", "PENDING", "COMPLETED"] } } } } });
  const cur = m.amount.currency;
  const v = (minor: number) => money(minor, cur, o.locale);
  const moved = payment?.refunds.filter((r) => r.status !== "PROPOSED").reduce((s, r) => s + r.amount_minor, 0) ?? 0;
  const proposed = payment?.refunds.filter((r) => r.status === "PROPOSED").reduce((s, r) => s + r.amount_minor, 0) ?? 0;
  const autoAt = m.auto_release_at ? new Date(m.auto_release_at) : null;
  return {
    ...m,
    money_state: m.state === "AWAITING_FUNDING" || m.state === "CANCELLED" ? "not funded" : m.state === "ACCEPTED" ? "released to the freelancer" : m.state === "REFUNDED" ? "refunded to the client" : "in holding",
    auto_release: autoAt ? { at: autoAt.toISOString(), hours_left: Math.max(0, Math.round((autoAt.getTime() - now.getTime()) / 3_600_000)) } : null,
    payment: payment
      ? { gross: v(payment.gross_minor), captured_at: payment.captured_at?.toISOString() ?? null, net_to_freelancer: payment.net_to_freelancer_minor === null ? null : v(payment.net_to_freelancer_minor), demo_seed_data: payment.capture_id?.startsWith("SEED-") ?? false }
      : null,
    refunded: v(moved),
    refund_proposed: v(proposed),
    still_refundable: payment ? v(Math.max(0, payment.gross_minor - moved - proposed)) : v(0),
  };
}
