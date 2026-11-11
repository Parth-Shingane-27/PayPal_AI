import type { MilestoneState } from "@/generated/prisma/client";
import { prisma } from "../../db";
import { isInHolding } from "../../domain/milestones";
import { money } from "../../domain/money";
import { convertAtReference } from "../../domain/reference-rates";
import { freelancerLedger } from "./ledger";

/**
 * Read models for the dashboards and the AG Grid ledger. Every figure is in
 * minor units with a display string; cross-currency totals use the fixed
 * reference rates and say so.
 */

const DAY = 86_400_000;

type Period = { from: Date; to: Date };

/** One row per milestone (the ledger's Milestones tab). */
export async function milestoneRows(freelancerId: string, period: Period, locale: string) {
  const rows = await prisma.milestone.findMany({
    where: { freelancer_id: freelancerId, OR: [{ created_at: { gte: period.from, lt: period.to } }, { released_at: { gte: period.from, lt: period.to } }, { state: { in: ["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"] } }] },
    include: {
      contract: { select: { id: true, title: true, locale: true, service: { select: { title: true } }, client: { select: { name: true, company_name: true, country: true } } } },
      payments: { where: { status: "COMPLETED" }, include: { refunds: { where: { status: { in: ["PENDING", "COMPLETED"] } } } } },
      invoice: { select: { id: true, number: true } },
    },
    orderBy: { created_at: "desc" },
  });
  return rows.map((m) => {
    const p = m.payments[0];
    const refunded = p?.refunds.reduce((s, r) => s + r.amount_minor, 0) ?? 0;
    const fees = p ? (p.paypal_fee_minor ?? 0) + (p.platform_fee_minor ?? 0) + (p.fx_cost_minor ?? 0) : 0;
    const v = (minor: number) => money(minor, m.currency, locale);
    return {
      milestone_id: m.id,
      contract_id: m.contract.id,
      contract: m.contract.title,
      milestone: `${m.position}. ${m.title}`,
      service: m.contract.service?.title ?? null,
      client: m.contract.client.company_name ?? m.contract.client.name,
      client_country: m.contract.client.country,
      market: m.contract.locale,
      currency: m.currency,
      state: m.state,
      amount: v(m.amount_minor),
      in_holding: v(isInHolding(m.state) && p ? Math.max(0, p.gross_minor - refunded) : 0),
      paypal_fee: v(p?.paypal_fee_minor ?? 0),
      platform_fee: v(p?.platform_fee_minor ?? 0),
      fx_cost: v(p?.fx_cost_minor ?? 0),
      fees: v(fees),
      fees_are_estimates: p?.fee_is_estimate ?? false,
      net: p?.net_to_freelancer_minor === null || !p ? null : v(p.net_to_freelancer_minor),
      refunded: v(refunded),
      due_date: m.due_date?.toISOString().slice(0, 10) ?? null,
      funded_at: m.funded_at?.toISOString() ?? null,
      released_at: m.released_at?.toISOString() ?? null,
      invoice: m.invoice ? { invoice_id: m.invoice.id, number: m.invoice.number } : null,
    };
  });
}

type Agg = { currency: string; milestones: number; gross: number; inHolding: number; net: number; refunded: number };

function aggregate<K extends string>(rows: Awaited<ReturnType<typeof milestoneRows>>, keyOf: (r: (typeof rows)[number]) => K, locale: string) {
  const by = new Map<string, Agg & { key: K }>();
  for (const r of rows) {
    const key = keyOf(r);
    const id = `${key}|${r.currency}`;
    const a = by.get(id) ?? { key, currency: r.currency, milestones: 0, gross: 0, inHolding: 0, net: 0, refunded: 0 };
    a.milestones += 1;
    if (r.state !== "AWAITING_FUNDING" && r.state !== "CANCELLED") a.gross += r.amount.amount_minor;
    a.inHolding += r.in_holding.amount_minor;
    a.net += r.net?.amount_minor ?? 0;
    a.refunded += r.refunded.amount_minor;
    by.set(id, a);
  }
  return [...by.values()].map((a) => ({
    key: a.key,
    currency: a.currency,
    milestones: a.milestones,
    funded: money(a.gross, a.currency, locale),
    in_holding: money(a.inHolding, a.currency, locale),
    released_net: money(a.net, a.currency, locale),
    refunded: money(a.refunded, a.currency, locale),
  }));
}

/** Per-currency totals for the ledger's pinned footer rows (money is summed here, never in the browser). */
function totalsOf(rows: Awaited<ReturnType<typeof milestoneRows>>, locale: string) {
  const by = new Map<string, { milestones: number; amount: number; inHolding: number; fees: number; net: number; refunded: number }>();
  for (const r of rows) {
    const t = by.get(r.currency) ?? { milestones: 0, amount: 0, inHolding: 0, fees: 0, net: 0, refunded: 0 };
    t.milestones += 1;
    t.amount += r.amount.amount_minor;
    t.inHolding += r.in_holding.amount_minor;
    t.fees += r.fees.amount_minor;
    t.net += r.net?.amount_minor ?? 0;
    t.refunded += r.refunded.amount_minor;
    by.set(r.currency, t);
  }
  const m = (minor: number, c: string) => money(minor, c, locale);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, t]) => ({ currency, milestones: t.milestones, amount: m(t.amount, currency), in_holding: m(t.inHolding, currency), fees: m(t.fees, currency), net: m(t.net, currency), refunded: m(t.refunded, currency) }));
}

/** The AG Grid ledger: milestones plus the Clients, Services and Markets tabs, and per-currency totals. */
export async function freelancerLedgerGrid(freelancerId: string, period: Period, locale: string) {
  const milestones = await milestoneRows(freelancerId, period, locale);
  return {
    totals: totalsOf(milestones, locale),
    milestones,
    clients: aggregate(milestones, (r) => r.client, locale),
    services: aggregate(milestones, (r) => r.service ?? "Custom quote", locale),
    markets: aggregate(milestones, (r) => r.market, locale),
  };
}

const ACTIVE: MilestoneState[] = ["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"];

/** Freelancer home: balances, work in flight, what needs attention, released per month. */
export async function freelancerOverview(freelancerId: string, now = new Date()) {
  const f = await prisma.freelancer.findUniqueOrThrow({ where: { id: freelancerId } });
  const [lines, byState, dueSoon, quotes, months] = await Promise.all([
    freelancerLedger(freelancerId),
    prisma.milestone.groupBy({ by: ["state"], where: { freelancer_id: freelancerId }, _count: true }),
    prisma.milestone.count({ where: { freelancer_id: freelancerId, state: { in: ["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED"] }, due_date: { lte: new Date(now.getTime() + 2 * DAY) } } }),
    prisma.quote.count({ where: { freelancer_id: freelancerId, status: "REQUESTED" } }),
    prisma.milestonePayment.findMany({ where: { freelancer_id: freelancerId, released_at: { gte: new Date(now.getTime() - 182 * DAY) } }, select: { currency: true, net_to_freelancer_minor: true, released_at: true } }),
  ]);
  const home = f.currency;
  const toHome = (minor: number, c: string) => convertAtReference(minor, c, home);
  const released = new Map<string, number>();
  for (const p of months) {
    const k = p.released_at!.toISOString().slice(0, 7);
    released.set(k, (released.get(k) ?? 0) + toHome(p.net_to_freelancer_minor ?? 0, p.currency));
  }
  const m = (minor: number) => money(minor, home, f.locale);
  return {
    home_currency: home,
    balances: lines.map((l) => ({ currency: l.currency, available: money(l.available, l.currency, f.locale), in_holding: money(l.inHolding, l.currency, f.locale) })),
    totals_at_reference_rates: {
      available: m(lines.reduce((s, l) => s + toHome(l.available, l.currency), 0)),
      in_holding: m(lines.reduce((s, l) => s + toHome(l.inHolding, l.currency), 0)),
    },
    milestones_by_state: Object.fromEntries(byState.map((b) => [b.state, b._count])),
    active_milestones: byState.filter((b) => ACTIVE.includes(b.state)).reduce((s, b) => s + b._count, 0),
    due_within_48h: dueSoon,
    quote_requests_waiting: quotes,
    released_by_month: [...released.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, minor]) => ({ month, net: m(minor) })),
    note: "Totals across currencies use fixed reference rates; every milestone keeps its own currency.",
  };
}

/** Client home: projects in flight, deliveries waiting for them, spend per month. */
export async function clientOverview(clientId: string, locale: string, now = new Date()) {
  const [byState, waiting, payments] = await Promise.all([
    prisma.milestone.groupBy({ by: ["state"], where: { client_id: clientId }, _count: true }),
    prisma.milestone.findMany({
      where: { client_id: clientId, state: "DELIVERED" },
      include: { contract: { select: { id: true, title: true, freelancer: { select: { name: true } } } } },
      orderBy: { auto_release_at: "asc" },
      take: 20,
    }),
    prisma.milestonePayment.findMany({ where: { client_id: clientId, status: "COMPLETED", captured_at: { gte: new Date(now.getTime() - 182 * DAY) } }, select: { currency: true, gross_minor: true, captured_at: true } }),
  ]);
  const spend = new Map<string, { currency: string; minor: number }>();
  for (const p of payments) {
    const k = `${p.captured_at!.toISOString().slice(0, 7)}|${p.currency}`;
    spend.set(k, { currency: p.currency, minor: (spend.get(k)?.minor ?? 0) + p.gross_minor });
  }
  return {
    milestones_by_state: Object.fromEntries(byState.map((b) => [b.state, b._count])),
    awaiting_your_review: waiting.map((m) => ({
      milestone_id: m.id,
      contract_id: m.contract.id,
      contract: m.contract.title,
      milestone: m.title,
      freelancer: m.contract.freelancer.name,
      amount: money(m.amount_minor, m.currency, locale),
      auto_release_at: m.auto_release_at?.toISOString() ?? null,
    })),
    paid_by_month: [...spend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ month: k.split("|")[0], amount: money(v.minor, v.currency, locale) })),
  };
}

/**
 * Landing page numbers from the demo data: freelancers, markets, milestones
 * released in 90 days, where a released $100 goes (fee anatomy), and one
 * featured service per freelancer (en-US pages). USD at reference rates.
 */
export async function gigMarketplaceStats(now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const [freelancers, clients, released, refunds, pages, markets] = await Promise.all([
    prisma.freelancer.findMany({ select: { id: true, name: true, country: true, headline: true } }),
    prisma.client.count(),
    prisma.milestonePayment.findMany({ where: { released_at: { gte: since } }, select: { currency: true, gross_minor: true, paypal_fee_minor: true, platform_fee_minor: true, fx_cost_minor: true } }),
    prisma.milestoneRefund.findMany({ where: { from_holding: false, status: { in: ["PENDING", "COMPLETED"] }, created_at: { gte: since } }, select: { currency: true, freelancer_debit_minor: true } }),
    prisma.servicePage.findMany({ where: { status: "PUBLISHED", locale: "en-US" }, include: { prices: true, service: { select: { rating_avg: true, category: true } } } }),
    prisma.servicePage.groupBy({ by: ["locale"], where: { status: "PUBLISHED" } }),
  ]);
  const usd = (minor: number, currency: string) => convertAtReference(minor, currency, "USD");
  const t = { gross: 0, paypal: 0, platform: 0, fx: 0, refunds: 0 };
  for (const p of released) {
    t.gross += usd(p.gross_minor, p.currency);
    t.paypal += usd(p.paypal_fee_minor ?? 0, p.currency);
    t.platform += usd(p.platform_fee_minor ?? 0, p.currency);
    t.fx += usd(p.fx_cost_minor ?? 0, p.currency);
  }
  for (const r of refunds) t.refunds += usd(r.freelancer_debit_minor ?? 0, r.currency);
  const net = t.gross - t.paypal - t.platform - t.fx - t.refunds;
  const share = (v: number) => (t.gross > 0 ? Math.round((v * 10_000) / t.gross) : 0);
  const featured = freelancers
    .map((f) => {
      const best = pages.filter((p) => p.freelancer_id === f.id && p.prices.length).sort((a, b) => (b.service.rating_avg ?? 0) - (a.service.rating_avg ?? 0))[0];
      if (!best) return null;
      const from = Math.min(...best.prices.map((x) => x.price_minor));
      return { page_id: best.id, title: best.title, category: best.service.category, from_price: money(from, best.currency, "en-US"), freelancer: f.name, headline: f.headline, country: f.country };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
  return {
    freelancers: freelancers.length,
    clients,
    markets: markets.length,
    milestones_90d: released.length,
    released_90d: money(t.gross, "USD", "en-US"),
    anatomy_bps: { net: share(net), paypal: share(t.paypal), platform: share(t.platform), fx: share(t.fx), refunds: share(t.refunds) },
    featured,
  };
}
