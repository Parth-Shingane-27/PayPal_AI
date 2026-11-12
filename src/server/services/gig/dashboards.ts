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
      contract: { select: { id: true, title: true, locale: true, client: { select: { name: true, company_name: true, country: true } } } },
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

/** The AG Grid ledger: milestones plus the Clients, Projects (stored as `services`) and Markets tabs, and per-currency totals. */
export async function freelancerLedgerGrid(freelancerId: string, period: Period, locale: string) {
  const milestones = await milestoneRows(freelancerId, period, locale);
  return {
    totals: totalsOf(milestones, locale),
    milestones,
    clients: aggregate(milestones, (r) => r.client, locale),
    services: aggregate(milestones, (r) => r.contract, locale),
    markets: aggregate(milestones, (r) => r.market, locale),
  };
}

const ACTIVE: MilestoneState[] = ["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"];

/**
 * Freelancer home, four blocks: money, what is due next, proposals and the
 * projects that match their skills. Totals across currencies use the fixed
 * reference rates and say so.
 */
export async function freelancerHome(freelancerId: string, now = new Date()) {
  const f = await prisma.freelancer.findUniqueOrThrow({ where: { id: freelancerId } });
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [lines, next, dueSoon, waiting, won, open, mine] = await Promise.all([
    freelancerLedger(freelancerId),
    prisma.milestone.findMany({
      where: { freelancer_id: freelancerId, state: { in: ["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED", "DELIVERED"] } },
      include: { contract: { select: { id: true, title: true, client: { select: { name: true, company_name: true } } } } },
      orderBy: [{ due_date: { sort: "asc", nulls: "last" } }, { created_at: "asc" }],
      take: 3,
    }),
    prisma.milestone.count({ where: { freelancer_id: freelancerId, state: { in: ["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED"] }, due_date: { lte: new Date(now.getTime() + 2 * DAY) } } }),
    prisma.quote.count({ where: { freelancer_id: freelancerId, status: "SENT", OR: [{ expires_at: null }, { expires_at: { gt: now } }] } }),
    prisma.quote.count({ where: { freelancer_id: freelancerId, status: "ACCEPTED", decided_at: { gte: monthStart } } }),
    prisma.brief.findMany({ where: { status: "OPEN", quotes: { none: { freelancer_id: freelancerId } } }, select: { skills: true } }),
    prisma.milestone.count({ where: { freelancer_id: freelancerId, state: { in: ACTIVE } } }),
  ]);
  const skills = new Set(f.skills.map((x) => x.toLowerCase()));
  const matching = open.filter((b) => b.skills.some((x) => skills.has(x.toLowerCase()))).length;
  const home = f.currency;
  const toHome = (minor: number, c: string) => convertAtReference(minor, c, home);
  const m = (minor: number) => money(minor, home, f.locale);
  return {
    home_currency: home,
    balances: lines.map((l) => ({ currency: l.currency, available: money(l.available, l.currency, f.locale), in_holding: money(l.inHolding, l.currency, f.locale) })),
    totals_at_reference_rates: {
      available: m(lines.reduce((s, l) => s + toHome(l.available, l.currency), 0)),
      in_holding: m(lines.reduce((s, l) => s + toHome(l.inHolding, l.currency), 0)),
    },
    can_request_payout: lines.some((l) => l.available > 0),
    next_up: next.map((x) => ({
      milestone_id: x.id,
      contract_id: x.contract.id,
      contract: x.contract.title,
      milestone: x.title,
      client: x.contract.client.company_name ?? x.contract.client.name,
      state: x.state,
      due_date: x.due_date?.toISOString().slice(0, 10) ?? null,
      amount: money(x.amount_minor, x.currency, f.locale),
    })),
    active_milestones: mine,
    due_within_48h: dueSoon,
    proposals_waiting: waiting,
    proposals_won_this_month: won,
    new_matching_projects: matching,
    open_projects: open.length,
  };
}

/**
 * Client home, one list of what needs a decision (proposals to choose from,
 * deliveries to accept, plans ready to fund), plus active projects and money.
 */
export async function clientHome(clientId: string, locale: string, now = new Date()) {
  const [open, delivered, drafts, active, paid, owed] = await Promise.all([
    prisma.brief.findMany({
      where: { client_id: clientId, status: "OPEN" },
      select: { id: true, title: true, _count: { select: { quotes: { where: { status: "SENT", OR: [{ expires_at: null }, { expires_at: { gt: now } }] } } } } },
      orderBy: { updated_at: "desc" },
      take: 20,
    }),
    prisma.milestone.findMany({
      where: { client_id: clientId, state: "DELIVERED" },
      include: { contract: { select: { id: true, title: true, freelancer: { select: { name: true } } } } },
      orderBy: { auto_release_at: "asc" },
      take: 20,
    }),
    prisma.contract.findMany({ where: { client_id: clientId, status: "DRAFT" }, select: { id: true, title: true, total_minor: true, currency: true }, orderBy: { created_at: "desc" }, take: 10 }),
    prisma.contract.findMany({
      where: { client_id: clientId, status: "ACTIVE" },
      include: { freelancer: { select: { name: true } }, milestones: { select: { state: true } } },
      orderBy: { created_at: "desc" },
      take: 10,
    }),
    prisma.milestonePayment.groupBy({ by: ["currency"], where: { client_id: clientId, status: "COMPLETED" }, _sum: { gross_minor: true } }),
    prisma.milestone.groupBy({ by: ["currency"], where: { client_id: clientId, state: "AWAITING_FUNDING", contract: { status: { in: ["DRAFT", "ACTIVE"] } } }, _sum: { amount_minor: true } }),
  ]);
  return {
    needs_decision: {
      proposals: open.filter((b) => b._count.quotes > 0).map((b) => ({ brief_id: b.id, title: b.title, proposals: b._count.quotes })),
      deliveries: delivered.map((m) => ({
        milestone_id: m.id,
        contract_id: m.contract.id,
        contract: m.contract.title,
        milestone: m.title,
        freelancer: m.contract.freelancer.name,
        amount: money(m.amount_minor, m.currency, locale),
        auto_release_at: m.auto_release_at?.toISOString() ?? null,
      })),
      plans_to_fund: drafts.map((c) => ({ contract_id: c.id, title: c.title, total: money(c.total_minor, c.currency, locale) })),
    },
    open_projects: open.length,
    active: active.map((c) => ({
      contract_id: c.id,
      title: c.title,
      freelancer: c.freelancer.name,
      done: c.milestones.filter((x) => x.state === "ACCEPTED").length,
      total: c.milestones.length,
    })),
    paid: paid.map((p) => money(p._sum.gross_minor ?? 0, p.currency, locale)),
    owed: owed.map((p) => money(p._sum.amount_minor ?? 0, p.currency, locale)),
  };
}

/**
 * Landing page numbers from the demo data: freelancers, clients, markets, open
 * projects, milestones released in 90 days and where a released $100 goes
 * (fee anatomy), plus a few open projects. USD at reference rates.
 */
export async function gigMarketplaceStats(now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const [freelancers, clients, released, refunds, openProjects, markets, openCount] = await Promise.all([
    prisma.freelancer.count(),
    prisma.client.count(),
    prisma.milestonePayment.findMany({ where: { released_at: { gte: since } }, select: { currency: true, gross_minor: true, paypal_fee_minor: true, platform_fee_minor: true, fx_cost_minor: true } }),
    prisma.milestoneRefund.findMany({ where: { from_holding: false, status: { in: ["PENDING", "COMPLETED"] }, created_at: { gte: since } }, select: { currency: true, freelancer_debit_minor: true } }),
    prisma.brief.findMany({ where: { status: "OPEN" }, orderBy: { created_at: "desc" }, take: 6, include: { client: { select: { name: true, company_name: true, country: true } } } }),
    prisma.client.groupBy({ by: ["locale"] }),
    prisma.brief.count({ where: { status: "OPEN" } }),
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
  return {
    freelancers,
    clients,
    markets: markets.length,
    open_projects: openCount,
    milestones_90d: released.length,
    released_90d: money(t.gross, "USD", "en-US"),
    anatomy_bps: { net: share(net), paypal: share(t.paypal), platform: share(t.platform), fx: share(t.fx), refunds: share(t.refunds) },
    featured: openProjects.map((b) => ({
      project_id: b.id,
      title: b.title,
      skills: b.skills.slice(0, 3),
      client: b.client.company_name ?? b.client.name,
      country: b.client.country,
      budget: b.budget_minor !== null && b.budget_currency ? money(b.budget_minor, b.budget_currency, "en-US") : null,
    })),
  };
}
