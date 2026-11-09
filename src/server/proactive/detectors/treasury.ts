import { prisma } from "../../db";
import { estimatePayoutFee, payoutFeeCapThreshold } from "../../domain/fees";
import { money } from "../../domain/money";
import { forecastEarnings } from "../../services/insights";
import { earningsByMarket, ledger, resolvePeriod } from "../../services/ledger";
import { maxPayoutFor } from "../../services/payouts";
import { DAY_MS, THRESHOLDS } from "../thresholds";
import type { Detection, Detector } from "./types";

/** Available balance big enough that a single payout reaches the fee cap (batching beyond it is free). */
export const payoutReady: Detector = async (sellerId) => {
  const out: Detection[] = [];
  for (const l of await ledger(sellerId)) {
    if (l.available <= 0) continue;
    const cap = payoutFeeCapThreshold(l.currency);
    if (l.available < cap) continue;
    const payout = maxPayoutFor(l.available, l.currency);
    out.push({
      agent: "TREASURY",
      type: "payout_ready",
      subject: l.currency,
      severity: "LOW",
      summary: `${money(l.available, l.currency).display} is available. A single payout now pays the capped fee of about ${money(estimatePayoutFee(payout, l.currency), l.currency).display}.`,
      evidence: { currency: l.currency, available: money(l.available, l.currency), fee_cap_threshold: money(cap, l.currency), estimated_fee_is_estimate: true },
    });
  }
  return out;
};

/** Money available and unpaid for weeks. */
export const idleBalance: Detector = async (sellerId, now) => {
  const t = THRESHOLDS.idleBalance;
  const out: Detection[] = [];
  // Largest first, measured against each currency's own fee cap, so one finding names the balance that matters most.
  const lines = (await ledger(sellerId)).sort((a, b) => b.available / payoutFeeCapThreshold(b.currency) - a.available / payoutFeeCapThreshold(a.currency));
  for (const l of lines) {
    if (l.available <= 0 || l.available < payoutFeeCapThreshold(l.currency) * t.minShareOfCapThreshold) continue;
    const [lastPayout, firstCapture] = await Promise.all([
      prisma.payout.findFirst({ where: { seller_id: sellerId, currency: l.currency, status: { in: ["PROCESSING", "SUCCESS"] } }, orderBy: { created_at: "desc" }, select: { created_at: true } }),
      prisma.payment.findFirst({ where: { seller_id: sellerId, currency: l.currency, status: "COMPLETED" }, orderBy: { captured_at: "asc" }, select: { captured_at: true } }),
    ]);
    const since = lastPayout?.created_at ?? firstCapture?.captured_at;
    if (!since) continue;
    const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    if (days < t.days) continue;
    out.push({
      agent: "TREASURY",
      type: "idle_balance",
      subject: l.currency,
      severity: "LOW",
      summary: `${money(l.available, l.currency).display} has been available for ${days} days without a payout.`,
      evidence: { currency: l.currency, available: money(l.available, l.currency), days_since_last_payout_or_first_sale: days },
    });
    break;
  }
  return out;
};

/** Currency conversion eats a high share of a market's sales. */
export const fxDrag: Detector = async (sellerId, now) => {
  const t = THRESHOLDS.fxDrag;
  const period = resolvePeriod({ preset: "last_30_days" }, now);
  const { markets } = await earningsByMarket(sellerId, period, "en-US");
  const out: Detection[] = [];
  for (const r of markets) {
    const gross = r.gross_sales.amount_minor;
    if (r.orders < t.minOrders || gross <= 0) continue;
    const share = (r.fx_costs.amount_minor / gross) * 100;
    if (share >= t.minSharePercent) {
      out.push({
        agent: "TREASURY",
        type: "fx_drag",
        subject: r.market,
        severity: "LOW",
        summary: `Currency conversion cost ${Math.round(share * 10) / 10}% of your ${r.market} sales in the last 30 days (${r.fx_costs.display}).`,
        evidence: { market: r.market, fx_share_percent: Math.round(share * 10) / 10, fx_cost: r.fx_costs, gross: r.gross_sales, orders: r.orders },
      });
    }
  }
  return out;
};

/** Next-30-day forecast trend moved sharply. */
export const forecastShift: Detector = async (sellerId, now) => {
  const t = THRESHOLDS.forecastShift;
  const { forecasts } = await forecastEarnings(sellerId, { horizonDays: 30 }, "en-US", now);
  const out: Detection[] = [];
  // Only the biggest swing: a seller selling in seven currencies does not need seven forecasts.
  const swing = (f: (typeof forecasts)[number]) => Math.abs(f.last_28_days_net.amount_minor - f.previous_28_days_net.amount_minor);
  for (const f of [...forecasts].sort((a, b) => swing(b) - swing(a))) {
    if (f.low_confidence || f.trend_percent === null || Math.abs(f.trend_percent) < t.minTrendPercent) continue;
    out.push({
      agent: "TREASURY",
      type: "forecast_shift",
      subject: f.currency,
      severity: "LOW",
      summary: `Your ${f.currency} earnings are ${f.trend_percent > 0 ? "up" : "down"} ${Math.abs(f.trend_percent)}% on the previous 28 days; the next 30 days are forecast at ${f.forecast_net_earnings.display}.`,
      evidence: { currency: f.currency, trend_percent: f.trend_percent, forecast: f.forecast_net_earnings, last_28_days: f.last_28_days_net, previous_28_days: f.previous_28_days_net, forecast_is_estimate: true },
    });
    break;
  }
  return out;
};

export const TREASURY_DETECTORS: Detector[] = [payoutReady, idleBalance, fxDrag, forecastShift];
