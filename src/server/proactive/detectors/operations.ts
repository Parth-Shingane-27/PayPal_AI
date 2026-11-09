import { prisma } from "../../db";
import { money } from "../../domain/money";
import { detectAnomalies } from "../../services/insights";
import { DAY_MS, THRESHOLDS } from "../thresholds";
import type { Detection, Detector } from "./types";

/** The rule set that already exists for the chat agent, mapped to detections. */
export const existingAnomalies: Detector = async (sellerId, now) => {
  const { anomalies } = await detectAnomalies(sellerId, "en-US", now);
  const out: Detection[] = [];
  const spikes = anomalies.filter((a) => a.type === "fee_spike");
  // One finding for all unusually high fees: ten orders are one story, not ten.
  if (spikes.length > 0) {
    out.push({
      agent: "OPERATIONS",
      type: "fee_spike",
      subject: "all",
      severity: "MEDIUM",
      summary: spikes.length === 1 ? spikes[0]!.summary : `${spikes.length} orders paid a PayPal fee well above your median rate. ${spikes[0]!.summary}`,
      evidence: { count: spikes.length, orders: spikes.slice(0, 10).map((a) => a.evidence) },
    });
  }
  for (const a of anomalies) {
    if (a.type === "fee_spike") continue;
    const e = a.evidence as Record<string, unknown>;
    const subject = String(e.order_id ?? e.listing_id ?? e.payout_id ?? e.buyer ?? "all");
    out.push({ agent: "OPERATIONS", type: a.type, subject, severity: a.severity.toUpperCase() as Detection["severity"], summary: a.summary, evidence: e });
  }
  return out;
};

type Window = { from: Date; to: Date };

async function windowStats(sellerId: string, w: Window) {
  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { seller_id: sellerId, status: "COMPLETED", captured_at: { gte: w.from, lt: w.to } },
      select: { order_id: true, currency: true, net_to_seller_minor: true, order: { select: { locale: true } } },
    }),
    prisma.refund.findMany({
      where: { seller_id: sellerId, status: { in: ["PENDING", "COMPLETED"] }, created_at: { gte: w.from, lt: w.to } },
      select: { order_id: true, currency: true, order: { select: { locale: true } } },
    }),
  ]);
  const by = new Map<string, { currency: string; orders: Set<string>; refunds: number; net: number }>();
  const row = (locale: string, currency: string) => {
    let r = by.get(locale);
    if (!r) by.set(locale, (r = { currency, orders: new Set(), refunds: 0, net: 0 }));
    return r;
  };
  for (const p of payments) {
    const r = row(p.order.locale, p.currency);
    r.orders.add(p.order_id);
    r.net += p.net_to_seller_minor ?? 0;
  }
  for (const f of refunds) row(f.order.locale, f.currency).refunds += 1;
  return by;
}

const weeks = (now: Date) => {
  const week = (i: number): Window => ({ from: new Date(now.getTime() - (i + 1) * 7 * DAY_MS), to: new Date(now.getTime() - i * 7 * DAY_MS) });
  return { thisWeek: week(0), lastWeek: week(1) };
};

/** A market's refund share this week is well above its trailing baseline. */
export const refundRateSpike: Detector = async (sellerId, now) => {
  const t = THRESHOLDS.refundRate;
  const { thisWeek } = weeks(now);
  const baseline: Window = { from: new Date(thisWeek.from.getTime() - t.baselineWeeks * 7 * DAY_MS), to: thisWeek.from };
  const [cur, base] = await Promise.all([windowStats(sellerId, thisWeek), windowStats(sellerId, baseline)]);
  const out: Detection[] = [];
  for (const [locale, c] of cur) {
    const rate = c.orders.size ? (c.refunds / c.orders.size) * 100 : 0;
    const b = base.get(locale);
    const baseRate = b && b.orders.size ? (b.refunds / b.orders.size) * 100 : 0;
    if (c.refunds < t.minRefunds || c.orders.size < t.minOrders) continue;
    if (rate >= baseRate * t.multiple && rate - baseRate >= t.minAbsolutePoints) {
      out.push({
        agent: "OPERATIONS",
        type: "refund_rate_spike",
        subject: locale,
        severity: rate >= 40 ? "HIGH" : "MEDIUM",
        summary: `Refunds in ${locale} are ${Math.round(rate)}% of orders this week (${c.refunds} of ${c.orders.size}), against about ${Math.round(baseRate)}% before.`,
        evidence: { market: locale, refunds_this_week: c.refunds, orders_this_week: c.orders.size, refund_rate_percent: Math.round(rate), baseline_rate_percent: Math.round(baseRate) },
      });
    }
  }
  return out;
};

/** A market's net earnings fell sharply week over week. */
export const earningsDrop: Detector = async (sellerId, now) => {
  const t = THRESHOLDS.earningsDrop;
  const { thisWeek, lastWeek } = weeks(now);
  const [cur, prev] = await Promise.all([windowStats(sellerId, thisWeek), windowStats(sellerId, lastWeek)]);
  const out: Detection[] = [];
  for (const [locale, p] of prev) {
    if (p.orders.size < t.minPriorOrders || p.net <= 0) continue;
    const net = cur.get(locale)?.net ?? 0;
    const drop = (p.net - net) / p.net;
    if (drop >= t.dropFraction) {
      out.push({
        agent: "OPERATIONS",
        type: "earnings_drop",
        subject: locale,
        severity: drop >= 0.7 ? "HIGH" : "MEDIUM",
        summary: `Net earnings in ${locale} fell ${Math.round(drop * 100)}% this week: ${money(net, p.currency).display} against ${money(p.net, p.currency).display} the week before.`,
        evidence: { market: locale, this_week: money(net, p.currency), last_week: money(p.net, p.currency), drop_percent: Math.round(drop * 100) },
      });
    }
  }
  return out;
};

/** Orders created but never paid for. */
export const stuckPendingPayment: Detector = async (sellerId, now) => {
  const cutoff = new Date(now.getTime() - THRESHOLDS.stuckPendingDays * DAY_MS);
  const stuck = await prisma.order.findMany({
    where: { seller_id: sellerId, status: "PENDING_PAYMENT", created_at: { lt: cutoff } },
    select: { id: true },
  });
  if (stuck.length === 0) return [];
  return [
    {
      agent: "OPERATIONS",
      type: "stuck_pending_payment",
      subject: "all",
      severity: "LOW",
      summary: `${stuck.length} order(s) have waited more than ${THRESHOLDS.stuckPendingDays} days for payment.`,
      evidence: { count: stuck.length, order_ids: stuck.slice(0, 10).map((o) => o.id) },
    },
  ];
};

/** Proposals the seller has not decided. */
export const approvalAging: Detector = async (sellerId, now) => {
  const cutoff = new Date(now.getTime() - THRESHOLDS.approvalAgingDays * DAY_MS);
  const waiting = await prisma.agentAction.findMany({
    where: { seller_id: sellerId, status: "PENDING_APPROVAL", created_at: { lt: cutoff } },
    select: { id: true, tool: true, created_at: true },
  });
  if (waiting.length === 0) return [];
  return [
    {
      agent: "OPERATIONS",
      type: "approval_aging",
      subject: "all",
      severity: "MEDIUM",
      summary: `${waiting.length} proposal(s) have been waiting for your approval for more than ${THRESHOLDS.approvalAgingDays} days.`,
      evidence: { count: waiting.length, proposals: waiting.slice(0, 10).map((w) => ({ action_id: w.id, tool: w.tool, since: w.created_at.toISOString().slice(0, 10) })) },
    },
  ];
};

export const OPERATIONS_DETECTORS: Detector[] = [existingAnomalies, refundRateSpike, earningsDrop, stuckPendingPayment, approvalAging];
