import { type Db, prisma } from "../db";
import { getMarket, isMarketLocale } from "../domain/markets";
import { money } from "../domain/money";
import { AppError } from "../errors";

/**
 * Seller ledger, per currency:
 *   earned    = net_to_seller of COMPLETED (captured) payments
 *   refunded  = seller_debit of PENDING and COMPLETED refunds
 *   paidOut   = amount + fee of PROCESSING and SUCCESS payouts
 *   reserved  = amount + fee of SCHEDULED payouts
 *   available = earned - refunded - paidOut - reserved
 */

type LedgerLine = { currency: string; earned: number; refunded: number; paidOut: number; reserved: number; available: number };

export async function ledger(sellerId: string, db: Db = prisma): Promise<LedgerLine[]> {
  const [earned, refunded, payouts] = await Promise.all([
    db.payment.groupBy({
      by: ["currency"],
      where: { seller_id: sellerId, status: "COMPLETED" },
      _sum: { net_to_seller_minor: true },
    }),
    db.refund.groupBy({
      by: ["currency"],
      where: { seller_id: sellerId, status: { in: ["PENDING", "COMPLETED"] } },
      _sum: { seller_debit_minor: true },
    }),
    db.payout.groupBy({
      by: ["currency", "status"],
      where: { seller_id: sellerId, status: { in: ["SCHEDULED", "PROCESSING", "SUCCESS"] } },
      _sum: { amount_minor: true, fee_minor: true },
    }),
  ]);

  const lines = new Map<string, LedgerLine>();
  const line = (currency: string) => {
    let l = lines.get(currency);
    if (!l) {
      l = { currency, earned: 0, refunded: 0, paidOut: 0, reserved: 0, available: 0 };
      lines.set(currency, l);
    }
    return l;
  };
  for (const e of earned) line(e.currency).earned += e._sum.net_to_seller_minor ?? 0;
  for (const r of refunded) line(r.currency).refunded += r._sum.seller_debit_minor ?? 0;
  for (const p of payouts) {
    const total = (p._sum.amount_minor ?? 0) + (p._sum.fee_minor ?? 0);
    if (p.status === "SCHEDULED") line(p.currency).reserved += total;
    else line(p.currency).paidOut += total;
  }
  for (const l of lines.values()) l.available = l.earned - l.refunded - l.paidOut - l.reserved;
  return [...lines.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function availableMinor(sellerId: string, currency: string, db: Db = prisma): Promise<number> {
  return (await ledger(sellerId, db)).find((l) => l.currency === currency)?.available ?? 0;
}

export async function balancesView(sellerId: string, locale: string) {
  const lines = await ledger(sellerId);
  return {
    balances: lines.map((l) => ({
      currency: l.currency,
      earned: money(l.earned, l.currency, locale),
      refunded: money(l.refunded, l.currency, locale),
      paid_out: money(l.paidOut, l.currency, locale),
      reserved_for_scheduled_payouts: money(l.reserved, l.currency, locale),
      available: money(l.available, l.currency, locale),
    })),
    definitions:
      "earned = net of captured payments after PayPal, platform and FX fees; refunded = amounts debited for refunds; paid_out = payouts sent incl. fees; reserved = approved payouts not yet sent; available = earned - refunded - paid_out - reserved.",
  };
}

// --- Periods ------------------------------------------------------------------

export const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "year_to_date",
  "all_time",
] as const;
type PeriodPreset = (typeof PERIOD_PRESETS)[number];

type Period = { from: Date; to: Date; label: string };

const DAY = 86_400_000;

function utcDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError("INVALID_INPUT", `Dates must be YYYY-MM-DD; got "${s}".`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new AppError("INVALID_INPUT", `Invalid date "${s}".`);
  return d;
}

/** Resolves a preset or an explicit [from, to] (both inclusive dates, UTC). */
export function resolvePeriod(input: { preset?: PeriodPreset; from?: string; to?: string }, now = new Date()): Period {
  if (input.from || input.to) {
    if (!input.from || !input.to) throw new AppError("INVALID_INPUT", "Give both from and to dates.");
    const from = utcDate(input.from);
    const to = new Date(utcDate(input.to).getTime() + DAY);
    if (to <= from) throw new AppError("INVALID_INPUT", "The end date must not be before the start date.");
    return { from, to, label: `${input.from} to ${input.to}` };
  }
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startOfToday = Date.UTC(y, m, now.getUTCDate());
  const tomorrow = new Date(startOfToday + DAY);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const period = (from: Date, to: Date, name: string): Period => ({
    from,
    to,
    label: `${name} (${iso(from)} to ${iso(new Date(to.getTime() - DAY))})`,
  });
  switch (input.preset ?? "last_30_days") {
    case "this_month":
      return period(new Date(Date.UTC(y, m, 1)), tomorrow, "this month");
    case "last_month":
      return period(new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1)), "last month");
    case "last_7_days":
      return period(new Date(startOfToday - 6 * DAY), tomorrow, "last 7 days");
    case "last_30_days":
      return period(new Date(startOfToday - 29 * DAY), tomorrow, "last 30 days");
    case "last_90_days":
      return period(new Date(startOfToday - 89 * DAY), tomorrow, "last 90 days");
    case "year_to_date":
      return period(new Date(Date.UTC(y, 0, 1)), tomorrow, "year to date");
    case "all_time":
      return { from: new Date(0), to: tomorrow, label: "all time" };
  }
}

// --- Earnings by market ---------------------------------------------------------

/**
 * Captured sales and refunds in a period, grouped by market (locale) and
 * currency. Sales count by capture date; refunds by refund date.
 */
export async function earningsByMarket(sellerId: string, period: Period, viewLocale: string, market?: string) {
  if (market !== undefined && !isMarketLocale(market)) throw new AppError("INVALID_INPUT", `Unknown market ${market}.`);
  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: {
        seller_id: sellerId,
        status: "COMPLETED",
        captured_at: { gte: period.from, lt: period.to },
        ...(market ? { order: { locale: market } } : {}),
      },
      include: { order: { select: { locale: true } } },
    }),
    prisma.refund.findMany({
      where: {
        seller_id: sellerId,
        status: { in: ["PENDING", "COMPLETED"] },
        created_at: { gte: period.from, lt: period.to },
        ...(market ? { order: { locale: market } } : {}),
      },
      include: { order: { select: { locale: true } } },
    }),
  ]);

  type Row = {
    locale: string;
    currency: string;
    orders: number;
    gross: number;
    paypal_fees: number;
    platform_fees: number;
    fx_costs: number;
    net: number;
    refunds: number;
    refund_debits: number;
    estimated_fee_orders: number;
  };
  const rows = new Map<string, Row>();
  const row = (locale: string, currency: string) => {
    const key = `${locale}|${currency}`;
    let r = rows.get(key);
    if (!r) {
      r = { locale, currency, orders: 0, gross: 0, paypal_fees: 0, platform_fees: 0, fx_costs: 0, net: 0, refunds: 0, refund_debits: 0, estimated_fee_orders: 0 };
      rows.set(key, r);
    }
    return r;
  };
  for (const p of payments) {
    const r = row(p.order.locale, p.currency);
    r.orders += 1;
    r.gross += p.gross_minor;
    r.paypal_fees += p.paypal_fee_minor ?? 0;
    r.platform_fees += p.platform_fee_minor ?? 0;
    r.fx_costs += p.fx_cost_minor ?? 0;
    r.net += p.net_to_seller_minor ?? 0;
    if (p.fee_is_estimate) r.estimated_fee_orders += 1;
  }
  for (const f of refunds) {
    const r = row(f.order.locale, f.currency);
    r.refunds += 1;
    r.refund_debits += f.seller_debit_minor ?? 0;
  }

  const sorted = [...rows.values()].sort((a, b) => a.locale.localeCompare(b.locale) || a.currency.localeCompare(b.currency));
  const m = (minor: number, currency: string) => money(minor, currency, viewLocale);
  const totals = new Map<string, { gross: number; net_after_refunds: number }>();
  for (const r of sorted) {
    const t = totals.get(r.currency) ?? { gross: 0, net_after_refunds: 0 };
    t.gross += r.gross;
    t.net_after_refunds += r.net - r.refund_debits;
    totals.set(r.currency, t);
  }
  return {
    period: { label: period.label, from: period.from.toISOString(), to_exclusive: period.to.toISOString() },
    market_filter: market ?? null,
    markets: sorted.map((r) => {
      const mk = getMarket(r.locale);
      return {
        market: r.locale,
        country: mk.country,
        currency: r.currency,
        orders: r.orders,
        gross_sales: m(r.gross, r.currency),
        paypal_fees: m(r.paypal_fees, r.currency),
        platform_fees: m(r.platform_fees, r.currency),
        fx_costs: m(r.fx_costs, r.currency),
        net_earnings: m(r.net, r.currency),
        refunds: r.refunds,
        refund_debits: m(r.refund_debits, r.currency),
        net_after_refunds: m(r.net - r.refund_debits, r.currency),
        orders_with_estimated_fees: r.estimated_fee_orders,
      };
    }),
    totals_by_currency: [...totals.entries()].map(([currency, t]) => ({
      currency,
      gross_sales: m(t.gross, currency),
      net_after_refunds: m(t.net_after_refunds, currency),
    })),
  };
}
