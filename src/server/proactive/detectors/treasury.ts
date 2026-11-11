import { prisma } from "../../db";
import { estimatePayoutFee, payoutFeeCapThreshold } from "../../domain/fees";
import { money } from "../../domain/money";
import { forecastFreelancerEarnings } from "../../services/gig/insights";
import { freelancerLedger } from "../../services/gig/ledger";
import { maxPayoutFor } from "../../domain/fees";
import { DAY_MS, THRESHOLDS } from "../thresholds";
import type { Detection, Detector } from "./types";

/** Released money big enough that one payout reaches the fee cap (batching beyond it is free). */
export const payoutReady: Detector = async (freelancerId) => {
  const out: Detection[] = [];
  for (const l of await freelancerLedger(freelancerId)) {
    const cap = payoutFeeCapThreshold(l.currency);
    if (l.available < cap) continue;
    const payout = maxPayoutFor(l.available, l.currency);
    out.push({
      agent: "TREASURY",
      type: "payout_ready",
      subject: l.currency,
      severity: "LOW",
      summary: `${money(l.available, l.currency).display} is available. A single payout now pays the capped fee of about ${money(estimatePayoutFee(payout, l.currency), l.currency).display}.`,
      evidence: { currency: l.currency, available: money(l.available, l.currency), in_holding: money(l.inHolding, l.currency), fee_cap_threshold: money(cap, l.currency), estimated_fee_is_estimate: true },
    });
  }
  return out;
};

/** Released money sitting unpaid for weeks (the largest one only). */
export const idleBalance: Detector = async (freelancerId, now) => {
  const t = THRESHOLDS.idleBalance;
  const lines = (await freelancerLedger(freelancerId)).sort((a, b) => b.available / payoutFeeCapThreshold(b.currency) - a.available / payoutFeeCapThreshold(a.currency));
  for (const l of lines) {
    if (l.available <= 0 || l.available < payoutFeeCapThreshold(l.currency) * t.minShareOfCapThreshold) continue;
    const [lastPayout, firstRelease] = await Promise.all([
      prisma.freelancerPayout.findFirst({ where: { freelancer_id: freelancerId, currency: l.currency, status: { in: ["PROCESSING", "SUCCESS"] } }, orderBy: { created_at: "desc" }, select: { created_at: true } }),
      prisma.milestonePayment.findFirst({ where: { freelancer_id: freelancerId, currency: l.currency, released_at: { not: null } }, orderBy: { released_at: "asc" }, select: { released_at: true } }),
    ]);
    const since = lastPayout?.created_at ?? firstRelease?.released_at;
    if (!since) continue;
    const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    if (days < t.days) continue;
    return [
      {
        agent: "TREASURY",
        type: "idle_balance",
        subject: l.currency,
        severity: "LOW",
        summary: `${money(l.available, l.currency).display} has been available for ${days} days without a payout.`,
        evidence: { currency: l.currency, available: money(l.available, l.currency), days_since_last_payout_or_first_release: days },
      },
    ];
  }
  return [];
};

/** FX cost above the normal spread in a client market (last 30 days of releases). */
export const fxDrag: Detector = async (freelancerId, now) => {
  const t = THRESHOLDS.fxDrag;
  const rows = await prisma.milestonePayment.findMany({
    where: { freelancer_id: freelancerId, status: "COMPLETED", released_at: { gte: new Date(now.getTime() - 30 * DAY_MS), lt: now } },
    select: { currency: true, gross_minor: true, fx_cost_minor: true, contract: { select: { locale: true } } },
  });
  const by = new Map<string, { currency: string; n: number; gross: number; fx: number }>();
  for (const r of rows) {
    const k = r.contract.locale;
    const a = by.get(k) ?? { currency: r.currency, n: 0, gross: 0, fx: 0 };
    a.n += 1;
    a.gross += r.gross_minor;
    a.fx += r.fx_cost_minor ?? 0;
    by.set(k, a);
  }
  const out: Detection[] = [];
  for (const [market, a] of by) {
    if (a.n < t.minMilestones || a.gross <= 0) continue;
    const share = (a.fx / a.gross) * 100;
    if (share < t.minSharePercent) continue;
    out.push({
      agent: "TREASURY",
      type: "fx_drag",
      subject: market,
      severity: "LOW",
      summary: `Currency conversion cost ${Math.round(share * 10) / 10}% of what clients in ${market} paid you in the last 30 days (${money(a.fx, a.currency).display}).`,
      evidence: { market, fx_share_percent: Math.round(share * 10) / 10, fx_cost: money(a.fx, a.currency), gross: money(a.gross, a.currency), milestones: a.n },
    });
  }
  return out;
};

/** Released money moved sharply against the 28 days before (the biggest swing only). */
export const forecastShift: Detector = async (freelancerId, now) => {
  const { forecasts } = await forecastFreelancerEarnings(freelancerId, { horizonDays: 30 }, "en-US", now);
  const swing = (f: (typeof forecasts)[number]) => Math.abs(f.released_last_28_days.amount_minor - f.released_previous_28_days.amount_minor);
  for (const f of [...forecasts].sort((a, b) => swing(b) - swing(a))) {
    if (f.trend_percent === null || Math.abs(f.trend_percent) < THRESHOLDS.forecastShift.minTrendPercent) continue;
    return [
      {
        agent: "TREASURY",
        type: "forecast_shift",
        subject: f.currency,
        severity: "LOW",
        summary: `Your released ${f.currency} earnings are ${f.trend_percent > 0 ? "up" : "down"} ${Math.abs(f.trend_percent)}% on the previous 28 days; contracted work due in the next 30 days is worth about ${f.forecast_net_earnings.display}.`,
        evidence: { currency: f.currency, trend_percent: f.trend_percent, forecast: f.forecast_net_earnings, in_holding: f.from_money_in_holding, last_28_days: f.released_last_28_days, previous_28_days: f.released_previous_28_days, forecast_is_estimate: true },
      },
    ];
  }
  return [];
};

/** A large amount entered holding this week: good news, and not payable until accepted. */
export const largeHoldingInflow: Detector = async (freelancerId, now) => {
  const t = THRESHOLDS.largeHolding;
  const since = new Date(now.getTime() - t.days * DAY_MS);
  const all = await prisma.milestone.findMany({ where: { freelancer_id: freelancerId, funded_at: { not: null } }, select: { currency: true, amount_minor: true, funded_at: true, state: true } });
  const by = new Map<string, { amounts: number[]; recent: number; count: number }>();
  for (const m of all) {
    const a = by.get(m.currency) ?? { amounts: [], recent: 0, count: 0 };
    a.amounts.push(m.amount_minor);
    if (m.funded_at! >= since && m.state !== "REFUNDED") {
      a.recent += m.amount_minor;
      a.count += 1;
    }
    by.set(m.currency, a);
  }
  const out: Detection[] = [];
  for (const [currency, a] of by) {
    if (a.count === 0 || a.amounts.length < 3) continue;
    const sorted = [...a.amounts].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (a.recent < median * t.multipleOfMedian) continue;
    out.push({
      agent: "TREASURY",
      type: "large_holding_inflow",
      subject: currency,
      severity: "LOW",
      summary: `Clients funded ${money(a.recent, currency).display} across ${a.count} milestone(s) this week. It is in holding and becomes available as each client accepts.`,
      evidence: { currency, funded_this_week: money(a.recent, currency), milestones: a.count, median_milestone: money(median, currency) },
    });
  }
  return out;
};

export const TREASURY_DETECTORS: Detector[] = [payoutReady, idleBalance, fxDrag, forecastShift, largeHoldingInflow];
