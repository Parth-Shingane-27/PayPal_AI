import { type FxApi, frankfurter } from "../clients/frankfurter";
import { prisma } from "../db";
import { ESTIMATE_NOTE, estimatePayoutFee, estimateSaleFees, FEE_TABLE, payoutFeeCapThreshold } from "../domain/fees";
import { getMarket, isMarketLocale } from "../domain/markets";
import { convertMinor, money, parseDecimal } from "../domain/money";
import { AppError, notFound } from "../errors";
import { feeView, saleContextFor } from "./pricing";

const DAY = 86_400_000;

// --- Forecast -------------------------------------------------------------------

const FORECAST_WINDOW_DAYS = 28;
const LOW_CONFIDENCE_SALES = 5;

/**
 * Trailing-average forecast per currency. Two 28-day windows give a recent
 * daily average and a trend; the forecast is recent_daily * horizon, adjusted
 * by half the trend (clamped to +/-50%). Fewer than 5 sales in the 56 days is
 * flagged low confidence.
 */
export async function forecastEarnings(sellerId: string, input: { currency?: string; horizonDays: number }, viewLocale: string, now = new Date()) {
  if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > 180) {
    throw new AppError("INVALID_INPUT", "The forecast horizon must be 1 to 180 days.");
  }
  const end = now.getTime();
  const mid = end - FORECAST_WINDOW_DAYS * DAY;
  const start = end - 2 * FORECAST_WINDOW_DAYS * DAY;

  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { seller_id: sellerId, status: "COMPLETED", captured_at: { gte: new Date(start), lt: now }, ...(input.currency ? { currency: input.currency } : {}) },
      select: { currency: true, net_to_seller_minor: true, captured_at: true },
    }),
    prisma.refund.findMany({
      where: { seller_id: sellerId, status: { in: ["PENDING", "COMPLETED"] }, created_at: { gte: new Date(start), lt: now }, ...(input.currency ? { currency: input.currency } : {}) },
      select: { currency: true, seller_debit_minor: true, created_at: true },
    }),
  ]);

  type Acc = { recent: number; prior: number; sales: number };
  const by = new Map<string, Acc>();
  const acc = (c: string) => {
    let a = by.get(c);
    if (!a) by.set(c, (a = { recent: 0, prior: 0, sales: 0 }));
    return a;
  };
  for (const p of payments) {
    const a = acc(p.currency);
    a.sales += 1;
    if (p.captured_at!.getTime() >= mid) a.recent += p.net_to_seller_minor ?? 0;
    else a.prior += p.net_to_seller_minor ?? 0;
  }
  for (const r of refunds) {
    const a = acc(r.currency);
    if (r.created_at.getTime() >= mid) a.recent -= r.seller_debit_minor ?? 0;
    else a.prior -= r.seller_debit_minor ?? 0;
  }

  return {
    horizon_days: input.horizonDays,
    method: `Trailing average of net earnings after refunds over the last ${FORECAST_WINDOW_DAYS} days, adjusted by half the trend versus the ${FORECAST_WINDOW_DAYS} days before (trend capped at +/-50%).`,
    forecasts: [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, a]) => {
        const recentDaily = a.recent / FORECAST_WINDOW_DAYS;
        const trend = a.prior > 0 ? (a.recent - a.prior) / a.prior : null;
        const used = Math.max(-0.5, Math.min(0.5, trend ?? 0));
        const forecast = Math.max(0, Math.round(recentDaily * input.horizonDays * (1 + used / 2)));
        const m = (minor: number) => money(minor, currency, viewLocale);
        return {
          currency,
          forecast_net_earnings: m(forecast),
          last_28_days_net: m(a.recent),
          previous_28_days_net: m(a.prior),
          trend_percent: trend === null ? null : Math.round(trend * 1000) / 10,
          sales_in_last_56_days: a.sales,
          low_confidence: a.sales < LOW_CONFIDENCE_SALES,
          confidence_note:
            a.sales < LOW_CONFIDENCE_SALES
              ? `Only ${a.sales} sale(s) in 56 days; treat this forecast as a rough indication.`
              : "Based on at least 5 recent sales.",
        };
      }),
  };
}

// --- Anomalies ------------------------------------------------------------------

const ANOMALY_RULES = [
  "fee_spike: a payment whose PayPal fee rate is above 1.5x the seller's median (needs 3+ payments)",
  "repeat_refunds: a buyer with 2 or more refunds in the last 30 days",
  "listing_refund_rate: a listing with a refund rate of 30% or more and at least 2 refunds",
  "failed_payments: 3 or more failed or declined payments in the last 30 days",
  "failed_payout: any payout that failed in the last 90 days",
];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export async function detectAnomalies(sellerId: string, viewLocale: string, now = new Date()) {
  const d30 = new Date(now.getTime() - 30 * DAY);
  const d90 = new Date(now.getTime() - 90 * DAY);
  const anomalies: { type: string; severity: "low" | "medium" | "high"; summary: string; evidence: Record<string, unknown> }[] = [];

  // 1. Fee spikes
  const paid = await prisma.payment.findMany({
    where: { seller_id: sellerId, status: "COMPLETED", paypal_fee_minor: { not: null }, gross_minor: { gt: 0 } },
    select: { id: true, order_id: true, gross_minor: true, paypal_fee_minor: true, currency: true, fee_is_estimate: true },
  });
  if (paid.length >= 3) {
    const rates = paid.map((p) => (p.paypal_fee_minor! * 10_000) / p.gross_minor);
    const med = median(rates);
    paid.forEach((p, i) => {
      if (rates[i]! > 1.5 * med) {
        anomalies.push({
          type: "fee_spike",
          severity: "medium",
          summary: `Order ${p.order_id} paid a PayPal fee of ${(rates[i]! / 100).toFixed(2)}% of the sale, above 1.5x your median of ${(med / 100).toFixed(2)}%.`,
          evidence: {
            order_id: p.order_id,
            fee: money(p.paypal_fee_minor!, p.currency, viewLocale),
            gross: money(p.gross_minor, p.currency, viewLocale),
            fee_rate_percent: Math.round(rates[i]!) / 100,
            median_fee_rate_percent: Math.round(med) / 100,
            fee_is_estimate: p.fee_is_estimate,
          },
        });
      }
    });
  }

  // 2. Buyers with repeated refunds
  const recentRefunds = await prisma.refund.findMany({
    where: { seller_id: sellerId, created_at: { gte: d30 }, status: { in: ["PROPOSED", "PENDING", "COMPLETED"] } },
    include: { order: { include: { buyer: { select: { id: true, name: true } } } } },
  });
  const byBuyer = new Map<string, typeof recentRefunds>();
  for (const r of recentRefunds) byBuyer.set(r.order.buyer.id, [...(byBuyer.get(r.order.buyer.id) ?? []), r]);
  for (const list of byBuyer.values()) {
    if (list.length >= 2) {
      anomalies.push({
        type: "repeat_refunds",
        severity: "medium",
        summary: `${list[0]!.order.buyer.name} has had ${list.length} refunds in the last 30 days.`,
        evidence: { buyer: list[0]!.order.buyer.name, refunds: list.map((r) => ({ order_id: r.order_id, amount: money(r.amount_minor, r.currency, viewLocale), reason: r.reason, status: r.status })) },
      });
    }
  }

  // 3. Listing refund rate
  const items = await prisma.orderItem.findMany({
    where: { order: { seller_id: sellerId, payments: { some: { status: "COMPLETED" } } } },
    select: { listing_id: true, title: true, order_id: true, order: { select: { refunds: { where: { status: { in: ["PENDING", "COMPLETED"] } }, select: { id: true } } } } },
  });
  const byListing = new Map<string, { title: string; orders: Set<string>; refunded: Set<string> }>();
  for (const it of items) {
    const e = byListing.get(it.listing_id) ?? { title: it.title, orders: new Set<string>(), refunded: new Set<string>() };
    e.orders.add(it.order_id);
    if (it.order.refunds.length > 0) e.refunded.add(it.order_id);
    byListing.set(it.listing_id, e);
  }
  for (const [listingId, e] of byListing) {
    const rate = e.refunded.size / e.orders.size;
    if (e.refunded.size >= 2 && rate >= 0.3) {
      anomalies.push({
        type: "listing_refund_rate",
        severity: "high",
        summary: `"${e.title}" was refunded on ${e.refunded.size} of ${e.orders.size} paid orders (${Math.round(rate * 100)}%).`,
        evidence: { listing_id: listingId, paid_orders: e.orders.size, refunded_orders: e.refunded.size, refund_rate_percent: Math.round(rate * 1000) / 10 },
      });
    }
  }

  // 4. Failed payments
  const failed = await prisma.payment.findMany({
    where: { seller_id: sellerId, status: { in: ["DECLINED", "FAILED"] }, created_at: { gte: d30 } },
    select: { order_id: true, failure_reason: true, created_at: true },
  });
  if (failed.length >= 3) {
    anomalies.push({
      type: "failed_payments",
      severity: "medium",
      summary: `${failed.length} payments failed or were declined in the last 30 days.`,
      evidence: { count: failed.length, orders: [...new Set(failed.map((f) => f.order_id))], reasons: [...new Set(failed.map((f) => f.failure_reason ?? "unknown"))] },
    });
  }

  // 5. Failed payouts
  const failedPayouts = await prisma.payout.findMany({ where: { seller_id: sellerId, status: "FAILED", updated_at: { gte: d90 } } });
  for (const p of failedPayouts) {
    anomalies.push({
      type: "failed_payout",
      severity: "high",
      summary: `A payout of ${money(p.amount_minor, p.currency, viewLocale).display} failed${p.error ? `: ${p.error}` : "."}`,
      evidence: { payout_id: p.id, amount: money(p.amount_minor, p.currency, viewLocale), error: p.error, scheduled_for: p.scheduled_for.toISOString().slice(0, 10) },
    });
  }

  return { checked_rules: ANOMALY_RULES, anomalies, anomaly_count: anomalies.length };
}

// --- Orders (Operations) ----------------------------------------------------------

export async function queryOrders(
  sellerId: string,
  filter: { status?: "PENDING_PAYMENT" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED"; market?: string; from?: Date; to?: Date; limit: number },
) {
  if (filter.market !== undefined && !isMarketLocale(filter.market)) throw new AppError("INVALID_INPUT", `Unknown market ${filter.market}.`);
  const orders = await prisma.order.findMany({
    where: {
      seller_id: sellerId,
      status: filter.status ?? { not: "CART" },
      ...(filter.market ? { locale: filter.market } : {}),
      ...(filter.from || filter.to ? { created_at: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
    },
    include: { items: true, buyer: { select: { name: true } } },
    orderBy: { created_at: "desc" },
    take: Math.max(1, Math.min(filter.limit, 50)),
  });
  return {
    orders: orders.map((o) => ({
      order_id: o.id,
      created_at: o.created_at.toISOString(),
      status: o.status,
      market: o.locale,
      buyer: o.buyer.name,
      items: o.items.map((i) => `${i.quantity} x ${i.title}`),
      total: money(o.items.reduce((s, i) => s + i.unit_price_minor * i.quantity, 0), o.currency, o.locale),
    })),
  };
}

export async function orderDetails(sellerId: string, orderId: string, viewLocale: string) {
  const o = await prisma.order.findFirst({
    where: { id: orderId, seller_id: sellerId, status: { not: "CART" } },
    include: {
      items: true,
      buyer: { select: { name: true, country: true } },
      payments: { orderBy: { created_at: "asc" } },
      refunds: { orderBy: { created_at: "asc" } },
    },
  });
  if (!o) throw notFound("Order");
  const m = (minor: number | null) => (minor === null ? null : money(minor, o.currency, viewLocale));
  return {
    order_id: o.id,
    status: o.status,
    market: o.locale,
    created_at: o.created_at.toISOString(),
    paid_at: o.paid_at?.toISOString() ?? null,
    buyer: o.buyer,
    items: o.items.map((i) => ({ title: i.title, sku: i.sku, quantity: i.quantity, unit_price: m(i.unit_price_minor) })),
    payments: o.payments.map((p) => ({
      status: p.status,
      created_at: p.created_at.toISOString(),
      gross: m(p.gross_minor),
      paypal_fee: m(p.paypal_fee_minor),
      paypal_fee_is_estimate: p.fee_is_estimate,
      platform_fee: m(p.platform_fee_minor),
      fx_cost: m(p.fx_cost_minor),
      net_to_seller: m(p.net_to_seller_minor),
      failure_reason: p.failure_reason,
      is_demo_seed_data: p.capture_id?.startsWith("SEED-") ?? false,
    })),
    refunds: o.refunds.map((r) => ({
      refund_id: r.id,
      status: r.status,
      reason: r.reason,
      amount: m(r.amount_minor),
      seller_debit: m(r.seller_debit_minor),
      created_at: r.created_at.toISOString(),
      completed_at: r.completed_at?.toISOString() ?? null,
      error: r.error,
    })),
  };
}

export async function paymentStatus(sellerId: string, orderId: string, viewLocale: string) {
  const o = await prisma.order.findFirst({
    where: { id: orderId, seller_id: sellerId, status: { not: "CART" } },
    include: { payments: { orderBy: { created_at: "desc" } }, refunds: true },
  });
  if (!o) throw notFound("Order");
  const captured = o.payments.find((p) => p.status === "COMPLETED");
  const m = (minor: number) => money(minor, o.currency, viewLocale);
  const moved = o.refunds.filter((r) => r.status === "PENDING" || r.status === "COMPLETED").reduce((s, r) => s + r.amount_minor, 0);
  const proposed = o.refunds.filter((r) => r.status === "PROPOSED").reduce((s, r) => s + r.amount_minor, 0);
  return {
    order_id: o.id,
    order_status: o.status,
    latest_payment_status: o.payments[0]?.status ?? null,
    payment_attempts: o.payments.length,
    captured: captured ? { gross: m(captured.gross_minor), captured_at: captured.captured_at?.toISOString() ?? null } : null,
    refunded: m(moved),
    refunds_awaiting_approval: m(proposed),
    still_refundable: captured ? m(Math.max(0, captured.gross_minor - moved - proposed)) : m(0),
  };
}

// --- Treasury -------------------------------------------------------------------

export async function estimateFeesFor(sellerId: string, input: { market: string; amount: string }) {
  if (!isMarketLocale(input.market)) throw new AppError("INVALID_INPUT", `Unknown market ${input.market}.`);
  const mk = getMarket(input.market);
  const gross = parseDecimal(input.amount, mk.currency);
  if (gross <= 0) throw new AppError("INVALID_INPUT", "Amount must be positive.");
  const sale = await saleContextFor(sellerId, input.market);
  const fees = estimateSaleFees(gross, sale);
  return {
    market: input.market,
    sale_amount: money(gross, mk.currency, mk.locale),
    international: sale.marketCountry !== sale.sellerCountry,
    currency_conversion: sale.currency !== sale.sellerCurrency,
    sale_fees: feeView(fees, mk.currency, mk.locale),
    payout_fee_if_paid_out_alone: money(estimatePayoutFee(fees.net_to_seller, mk.currency), mk.currency, mk.locale),
    payout_fee_cap: money(FEE_TABLE.payout_fee_cap_minor[mk.currency as keyof typeof FEE_TABLE.payout_fee_cap_minor], mk.currency, mk.locale),
    payout_size_where_fee_hits_cap: money(payoutFeeCapThreshold(mk.currency), mk.currency, mk.locale),
    fees_are_estimates: true,
    note: ESTIMATE_NOTE,
  };
}

/**
 * Honest side-by-side for one sale: GlobalCart (local currency, platform fee,
 * conversion spread, payout fee) versus a single-currency direct store in the
 * seller's home currency (no platform fee, but the buyer pays a conversion
 * spread). Both columns use the same estimate table.
 */
export async function compareSellingDirect(
  sellerId: string,
  input: { listingId?: string; market?: string; price?: string },
  fx: FxApi = frankfurter,
) {
  let market: string;
  let priceMinor: number;
  if (input.listingId) {
    const l = await prisma.listing.findFirst({ where: { id: input.listingId, seller_id: sellerId } });
    if (!l) throw notFound("Listing");
    market = l.locale;
    priceMinor = l.price_minor;
  } else {
    if (!input.market || !input.price) throw new AppError("INVALID_INPUT", "Give a listing_id, or a market and a price.");
    if (!isMarketLocale(input.market)) throw new AppError("INVALID_INPUT", `Unknown market ${input.market}.`);
    market = input.market;
    priceMinor = parseDecimal(input.price, getMarket(market).currency);
  }
  const mk = getMarket(market);
  const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
  const home = seller.currency;
  const rate = await fx.getRate(mk.currency, home);
  const toHome = (minor: number) => convertMinor(minor, mk.currency, home, rate.rate);

  // GlobalCart column
  const gcSale = await saleContextFor(sellerId, market);
  const gc = estimateSaleFees(priceMinor, gcSale);
  const gcPayoutFee = estimatePayoutFee(gc.net_to_seller, mk.currency);
  const gcNet = gc.net_to_seller - gcPayoutFee;

  // Direct column: same price, charged in the seller's home currency.
  const directPrice = toHome(priceMinor);
  const direct = estimateSaleFees(directPrice, {
    currency: home,
    marketCountry: mk.country,
    sellerCountry: seller.country,
    sellerCurrency: home,
    platformBps: 0,
  });
  const buyerSpread = mk.currency === home ? 0 : Math.round((directPrice * FEE_TABLE.conversion_bps) / 10_000);

  const hm = (minor: number) => money(minor, home, seller.locale);
  const lm = (minor: number) => money(minor, mk.currency, mk.locale);
  const gcNetHome = toHome(gcNet);
  const diff = gcNetHome - direct.net_to_seller;
  return {
    market,
    fx_rate: { from: rate.from, to: rate.to, rate: rate.rate, date: rate.date },
    globalcart: {
      buyer_pays: lm(priceMinor),
      buyer_currency: mk.currency,
      listing_language: mk.language,
      paypal_fee: lm(gc.paypal_fee),
      international_fee: lm(gc.international_fee),
      conversion_cost_for_seller: lm(gc.conversion_cost),
      platform_fee: lm(gc.platform_fee),
      payout_fee_if_paid_out_alone: lm(gcPayoutFee),
      net_to_seller: lm(gcNet),
      net_to_seller_in_home_currency: hm(gcNetHome),
    },
    direct_store: {
      buyer_pays: hm(directPrice),
      buyer_currency: home,
      buyer_conversion_cost_estimate: hm(buyerSpread),
      listing_language: "seller's own language only",
      paypal_fee: hm(direct.paypal_fee),
      international_fee: hm(direct.international_fee),
      platform_fee: hm(0),
      payout_fee: hm(0),
      net_to_seller: hm(direct.net_to_seller),
    },
    difference_for_seller: {
      amount: hm(Math.abs(diff)),
      globalcart_nets_more: diff > 0,
      summary:
        diff === 0
          ? "Both options net the seller the same."
          : diff > 0
            ? `GlobalCart nets the seller ${hm(diff).display} more on this sale.`
            : `Selling direct nets the seller ${hm(-diff).display} more on this sale; GlobalCart's extra cost buys a localized listing and local-currency pricing for the buyer.`,
    },
    batching_tip: `Payout fees are 2% capped at ${money(FEE_TABLE.payout_fee_cap_minor[mk.currency as keyof typeof FEE_TABLE.payout_fee_cap_minor], mk.currency, mk.locale).display} per payout, so batching sales into fewer, larger payouts lowers the payout fee per sale.`,
    fees_are_estimates: true,
    note: ESTIMATE_NOTE,
  };
}

// --- Buyer orders -------------------------------------------------------------

export async function buyerOrders(buyerId: string) {
  const orders = await prisma.order.findMany({
    where: { buyer_id: buyerId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "PENDING_PAYMENT"] } },
    include: { items: true, seller: { select: { name: true } }, refunds: { where: { status: { in: ["PENDING", "COMPLETED"] } } } },
    orderBy: { created_at: "desc" },
    take: 50,
  });
  return orders.map((o) => ({
    order_id: o.id,
    created_at: o.created_at.toISOString(),
    paid_at: o.paid_at?.toISOString() ?? null,
    status: o.status,
    seller: o.seller.name,
    items: o.items.map((i) => ({ title: i.title, quantity: i.quantity, unit_price: money(i.unit_price_minor, o.currency, o.locale) })),
    total: money(o.items.reduce((s, i) => s + i.unit_price_minor * i.quantity, 0), o.currency, o.locale),
    refunded: money(o.refunds.reduce((s, r) => s + r.amount_minor, 0), o.currency, o.locale),
  }));
}
