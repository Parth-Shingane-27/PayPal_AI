import { prisma } from "../db";
import { allocateByWeight, changeBps, lastMonthKeys, monthKey, monthProgress, ratioBps, weekIndex } from "../domain/analytics";
import { getMarket } from "../domain/markets";
import { money } from "../domain/money";
import { convertAtReference } from "../domain/reference-rates";
import { notFound } from "../errors";
import { detectAnomalies } from "./insights";
import { ledger, resolvePeriod } from "./ledger";

/**
 * Read models for the seller and buyer dashboards. Every function takes the
 * owner id first and filters by it. Native-currency amounts are the source of
 * truth; "_home" figures are converted at fixed reference rates so a
 * multi-currency seller can see one total, and are labelled as such in the UI.
 */

type Period = ReturnType<typeof resolvePeriod>;
const DAY = 86_400_000;
const SPARK_WEEKS = 12;
const CAPTURED = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

/** Currencies charted on their own; everything else is grouped as "OTHER". Order fixes the colour. */
export const CURRENCY_GROUPS = ["USD", "EUR", "GBP", "JPY"] as const;

/** Region of a market country, used to colour market charts consistently. */
export function regionOf(country: string): "Americas" | "Europe" | "Asia-Pacific" {
  if (["US", "CA", "MX"].includes(country)) return "Americas";
  if (["JP", "AU", "IN"].includes(country)) return "Asia-Pacific";
  return "Europe";
}

// --- Shared order loading -----------------------------------------------------------

type OrderFacts = {
  id: string;
  at: Date;
  status: string;
  locale: string;
  currency: string;
  captured: boolean;
  buyer: { id: string; name: string; country: string };
  seller: { id: string; name: string; country: string };
  lines: { title: string; sku: string; quantity: number; unit_price_minor: number; product_id: string; image_url: string | null }[];
  gross: number;
  paypal_fee: number;
  platform_fee: number;
  fx_cost: number;
  net: number;
  refunded: number;
  refund_debit: number;
  fee_is_estimate: boolean;
  failure_reason: string | null;
};

async function loadOrders(where: { seller_id: string } | { buyer_id: string }): Promise<OrderFacts[]> {
  const orders = await prisma.order.findMany({
    where: { ...where, status: { not: "CART" } },
    include: {
      buyer: { select: { id: true, name: true, country: true } },
      seller: { select: { id: true, name: true, country: true } },
      items: { include: { listing: { select: { product_id: true, product: { select: { image_url: true } } } } } },
      payments: { select: { status: true, gross_minor: true, paypal_fee_minor: true, platform_fee_minor: true, fx_cost_minor: true, net_to_seller_minor: true, fee_is_estimate: true, failure_reason: true } },
      refunds: { where: { status: { in: ["PENDING", "COMPLETED"] } }, select: { amount_minor: true, seller_debit_minor: true } },
    },
    orderBy: { created_at: "desc" },
  });
  return orders.map((o) => {
    const paid = o.payments.find((p) => p.status === "COMPLETED");
    const lines = o.items.map((i) => ({
      title: i.title,
      sku: i.sku,
      quantity: i.quantity,
      unit_price_minor: i.unit_price_minor,
      product_id: i.listing.product_id,
      image_url: i.listing.product.image_url,
    }));
    const lineTotal = lines.reduce((s, l) => s + l.unit_price_minor * l.quantity, 0);
    return {
      id: o.id,
      at: o.paid_at ?? o.created_at,
      status: o.status,
      locale: o.locale,
      currency: o.currency,
      captured: Boolean(paid),
      buyer: o.buyer,
      seller: o.seller,
      lines,
      gross: paid?.gross_minor ?? lineTotal,
      paypal_fee: paid?.paypal_fee_minor ?? 0,
      platform_fee: paid?.platform_fee_minor ?? 0,
      fx_cost: paid?.fx_cost_minor ?? 0,
      net: paid?.net_to_seller_minor ?? 0,
      refunded: o.refunds.reduce((s, r) => s + r.amount_minor, 0),
      refund_debit: o.refunds.reduce((s, r) => s + (r.seller_debit_minor ?? 0), 0),
      fee_is_estimate: paid?.fee_is_estimate ?? false,
      failure_reason: o.payments.find((p) => p.failure_reason)?.failure_reason ?? null,
    };
  });
}

const inPeriod = (d: Date, p: { from: Date; to: Date }) => d >= p.from && d < p.to;

function previousPeriod(p: Period): { from: Date; to: Date } | null {
  if (p.from.getTime() === 0) return null;
  const len = p.to.getTime() - p.from.getTime();
  return { from: new Date(p.from.getTime() - len), to: p.from };
}

type Totals = { orders: number; gross: number; paypal: number; platform: number; fx: number; refundDebit: number; refundedOrders: number; net: number };
function sumHome(orders: OrderFacts[], home: string): Totals {
  const t: Totals = { orders: 0, gross: 0, paypal: 0, platform: 0, fx: 0, refundDebit: 0, refundedOrders: 0, net: 0 };
  for (const o of orders) {
    if (!o.captured) continue;
    const h = (m: number) => convertAtReference(m, o.currency, home);
    t.orders += 1;
    t.gross += h(o.gross);
    t.paypal += h(o.paypal_fee);
    t.platform += h(o.platform_fee);
    t.fx += h(o.fx_cost);
    t.refundDebit += h(o.refund_debit);
    if (o.refunded > 0) t.refundedOrders += 1;
  }
  t.net = t.gross - t.paypal - t.platform - t.fx - t.refundDebit;
  return t;
}

async function sellerOrFail(sellerId: string) {
  const s = await prisma.seller.findUnique({ where: { id: sellerId }, select: { id: true, name: true, currency: true, locale: true, country: true } });
  if (!s) throw notFound("Seller");
  return s;
}

async function trafficBySellerListing(sellerId: string, period: { from: Date; to: Date }) {
  const rows = await prisma.listingDailyStat.groupBy({
    by: ["listing_id"],
    where: { listing: { seller_id: sellerId }, day: { gte: period.from, lt: period.to } },
    _sum: { views: true, cart_adds: true },
  });
  return new Map(rows.map((r) => [r.listing_id, { views: r._sum.views ?? 0, cart_adds: r._sum.cart_adds ?? 0 }]));
}

// --- Seller: sales ledger --------------------------------------------------------------

export async function sellerSalesRows(sellerId: string, period: Period) {
  const seller = await sellerOrFail(sellerId);
  const loc = seller.locale;
  const orders = (await loadOrders({ seller_id: sellerId })).filter((o) => inPeriod(o.at, period));
  const threads = await prisma.conversation.findMany({ where: { seller_id: sellerId, order_id: { in: orders.map((o) => o.id) } }, select: { id: true, order_id: true } });
  const threadByOrder = new Map(threads.map((t) => [t.order_id, t.id]));
  return {
    period: { label: period.label },
    home_currency: seller.currency,
    view_locale: loc,
    rows: orders.map((o) => {
      const m = (minor: number) => money(minor, o.currency, loc);
      const netAfter = o.net - o.refund_debit;
      return {
        order_id: o.id,
        date: o.at.toISOString(),
        status: o.status,
        buyer: o.buyer.name,
        buyer_country: o.buyer.country,
        market: o.locale,
        currency: o.currency,
        items: o.lines.map((l) => (l.quantity > 1 ? `${l.title} ×${l.quantity}` : l.title)).join(", "),
        units: o.lines.reduce((s, l) => s + l.quantity, 0),
        image_url: o.lines[0]?.image_url ?? null,
        gross: m(o.gross),
        paypal_fee: m(o.paypal_fee),
        platform_fee: m(o.platform_fee),
        fx_cost: m(o.fx_cost),
        refunded: m(o.refunded),
        refundable: m(o.captured ? Math.max(0, o.gross - o.refunded) : 0),
        net: m(o.captured ? netAfter : 0),
        net_home: money(o.captured ? convertAtReference(netAfter, o.currency, seller.currency) : 0, seller.currency, loc),
        fee_is_estimate: o.fee_is_estimate,
        failure_reason: o.failure_reason,
        conversation_id: threadByOrder.get(o.id) ?? null,
      };
    }),
  };
}

// --- Seller: product performance --------------------------------------------------------

export async function sellerProductRows(sellerId: string, period: Period, now = new Date()) {
  const seller = await sellerOrFail(sellerId);
  const home = seller.currency;
  const [products, orders, traffic] = await Promise.all([
    prisma.product.findMany({
      where: { seller_id: sellerId },
      include: { listings: { select: { id: true, locale: true, status: true, price_minor: true, currency: true } } },
      orderBy: { created_at: "asc" },
    }),
    loadOrders({ seller_id: sellerId }),
    trafficBySellerListing(sellerId, period),
  ]);

  type Acc = { units: number; orders: Set<string>; refundedOrders: Set<string>; netHome: number; grossHome: number; spark: number[] };
  const acc = new Map<string, Acc>();
  const get = (pid: string) => {
    let a = acc.get(pid);
    if (!a) acc.set(pid, (a = { units: 0, orders: new Set(), refundedOrders: new Set(), netHome: 0, grossHome: 0, spark: Array(SPARK_WEEKS).fill(0) }));
    return a;
  };
  for (const o of orders) {
    if (!o.captured) continue;
    const weights = o.lines.map((l) => l.unit_price_minor * l.quantity);
    const netShares = allocateByWeight(convertAtReference(o.net - o.refund_debit, o.currency, home), weights);
    const grossShares = allocateByWeight(convertAtReference(o.gross, o.currency, home), weights);
    const w = weekIndex(o.at, now, SPARK_WEEKS);
    o.lines.forEach((l, i) => {
      const a = get(l.product_id);
      if (w >= 0) a.spark[w]! += l.quantity;
      if (!inPeriod(o.at, period)) return;
      a.units += l.quantity;
      a.orders.add(o.id);
      if (o.refunded > 0) a.refundedOrders.add(o.id);
      a.netHome += netShares[i] ?? 0;
      a.grossHome += grossShares[i] ?? 0;
    });
  }

  const m = (minor: number) => money(minor, home, seller.locale);
  return {
    period: { label: period.label },
    home_currency: home,
    view_locale: seller.locale,
    rows: products.map((p) => {
      const a = get(p.id);
      const published = p.listings.filter((l) => l.status === "PUBLISHED");
      let views = 0;
      let cartAdds = 0;
      for (const l of p.listings) {
        const t = traffic.get(l.id);
        views += t?.views ?? 0;
        cartAdds += t?.cart_adds ?? 0;
      }
      const homePrices = published.map((l) => convertAtReference(l.price_minor, l.currency, home));
      return {
        product_id: p.id,
        sku: p.sku,
        title: p.title,
        category: p.category,
        image_url: p.image_url,
        markets: published.map((l) => l.locale).sort(),
        drafts: p.listings.filter((l) => l.status === "DRAFT").length,
        price_from: homePrices.length ? m(Math.min(...homePrices)) : null,
        stock: p.stock,
        rating: p.rating_avg,
        rating_count: p.rating_count,
        views,
        cart_adds: cartAdds,
        orders: a.orders.size,
        units: a.units,
        conversion_bps: ratioBps(a.orders.size, views),
        refund_rate_bps: ratioBps(a.refundedOrders.size, a.orders.size),
        gross_home: m(a.grossHome),
        net_home: m(a.netHome),
        weekly_units: a.spark,
      };
    }),
  };
}

// --- Seller: buyers --------------------------------------------------------------------

export async function sellerBuyerRows(sellerId: string, period: Period) {
  const seller = await sellerOrFail(sellerId);
  const home = seller.currency;
  const [orders, threads] = await Promise.all([
    loadOrders({ seller_id: sellerId }),
    prisma.conversation.findMany({ where: { seller_id: sellerId }, select: { buyer_id: true, seller_unread: true } }),
  ]);
  type Acc = { id: string; name: string; country: string; orders: number; units: number; netHome: number; refunds: number; last: Date | null; markets: Set<string> };
  const by = new Map<string, Acc>();
  for (const o of orders) {
    if (!o.captured || !inPeriod(o.at, period)) continue;
    let a = by.get(o.buyer.id);
    if (!a) by.set(o.buyer.id, (a = { ...o.buyer, orders: 0, units: 0, netHome: 0, refunds: 0, last: null, markets: new Set() }));
    a.orders += 1;
    a.units += o.lines.reduce((s, l) => s + l.quantity, 0);
    a.netHome += convertAtReference(o.net - o.refund_debit, o.currency, home);
    if (o.refunded > 0) a.refunds += 1;
    if (!a.last || o.at > a.last) a.last = o.at;
    a.markets.add(o.locale);
  }
  const m = (minor: number) => money(minor, home, seller.locale);
  return {
    period: { label: period.label },
    rows: [...by.values()].map((a) => ({
      buyer_id: a.id,
      buyer: a.name,
      country: a.country,
      markets: [...a.markets].sort(),
      orders: a.orders,
      units: a.units,
      net_home: m(a.netHome),
      avg_order_home: m(a.orders ? Math.round(a.netHome / a.orders) : 0),
      refunds: a.refunds,
      last_order: a.last?.toISOString() ?? null,
      threads: threads.filter((t) => t.buyer_id === a.id).length,
      unread: threads.filter((t) => t.buyer_id === a.id).reduce((s, t) => s + t.seller_unread, 0),
    })),
  };
}

// --- Seller: overview ---------------------------------------------------------------------

export async function sellerOverview(sellerId: string, period: Period, now = new Date()) {
  const seller = await sellerOrFail(sellerId);
  const home = seller.currency;
  const loc = seller.locale;
  const prev = previousPeriod(period);
  const [orders, traffic, prevTraffic, balances, unread] = await Promise.all([
    loadOrders({ seller_id: sellerId }),
    trafficBySellerListing(sellerId, period),
    prev ? trafficBySellerListing(sellerId, prev) : Promise.resolve(new Map<string, { views: number; cart_adds: number }>()),
    ledger(sellerId),
    prisma.conversation.aggregate({ where: { seller_id: sellerId }, _sum: { seller_unread: true } }),
  ]);
  const current = orders.filter((o) => inPeriod(o.at, period));
  const before = prev ? orders.filter((o) => inPeriod(o.at, prev)) : [];
  const t = sumHome(current, home);
  const p = sumHome(before, home);
  const views = [...traffic.values()].reduce((s, v) => s + v.views, 0);
  const prevViews = [...prevTraffic.values()].reduce((s, v) => s + v.views, 0);
  const m = (minor: number) => money(minor, home, loc);

  // Last six months, independent of the selected period.
  const months = lastMonthKeys(now, 6);
  const monthly = months.map((key) => {
    const s = sumHome(orders.filter((o) => monthKey(o.at) === key), home);
    return {
      month: key,
      ...monthProgress(key, now),
      orders: s.orders,
      gross: m(s.gross),
      net: m(s.net),
      paypal_fees: m(s.paypal),
      platform_fees: m(s.platform),
      fx_costs: m(s.fx),
      refunds: m(s.refundDebit),
    };
  });

  const byMarket = new Map<string, OrderFacts[]>();
  for (const o of current) if (o.captured) byMarket.set(o.locale, [...(byMarket.get(o.locale) ?? []), o]);
  const markets = [...byMarket.entries()]
    .map(([locale, os]) => {
      const s = sumHome(os, home);
      return {
        market: locale,
        country: getMarket(locale).country,
        region: regionOf(getMarket(locale).country),
        currency: getMarket(locale).currency,
        orders: s.orders,
        refunded_orders: os.filter((o) => o.refund_debit > 0).length,
        net: m(s.net),
        share_bps: ratioBps(s.net, t.net),
      };
    })
    .sort((a, b) => b.net.amount_minor - a.net.amount_minor);

  const available = balances.reduce((s, b) => s + convertAtReference(b.available, b.currency, home), 0);
  const failed = current.filter((o) => o.status === "PENDING_PAYMENT").length;

  return {
    seller: { name: seller.name, country: seller.country, home_currency: home, locale: loc },
    period: { label: period.label, compared_to_previous: prev !== null },
    kpis: {
      net: m(t.net),
      net_change_bps: prev ? changeBps(t.net, p.net) : null,
      gross: m(t.gross),
      orders: t.orders,
      orders_change_bps: prev ? changeBps(t.orders, p.orders) : null,
      avg_order: m(t.orders ? Math.round(t.gross / t.orders) : 0),
      views,
      conversion_bps: ratioBps(t.orders, views),
      conversion_change_bps: prev ? changeBps(ratioBps(t.orders, views), ratioBps(p.orders, prevViews)) : null,
      refund_rate_bps: ratioBps(t.refundedOrders, t.orders),
      failed_payments: failed,
      available: m(available),
      unread_messages: unread._sum.seller_unread ?? 0,
    },
    fee_anatomy: {
      gross: m(t.gross),
      paypal_fees: m(t.paypal),
      platform_fees: m(t.platform),
      fx_costs: m(t.fx),
      refunds: m(t.refundDebit),
      net: m(t.net),
      kept_bps: ratioBps(t.net, t.gross),
    },
    monthly,
    markets,
    balances: balances.map((b) => ({ currency: b.currency, available: money(b.available, b.currency, loc) })),
    reference_rates_note: `Totals in ${home} use fixed reference exchange rates; each sale is recorded in the currency the buyer paid.`,
  };
}

// --- Buyer ------------------------------------------------------------------------------------

export async function buyerPurchaseRows(buyerId: string, market: string) {
  const orders = await loadOrders({ buyer_id: buyerId });
  const threads = await prisma.conversation.findMany({ where: { buyer_id: buyerId }, select: { id: true, order_id: true, seller_id: true } });
  return {
    rows: orders.map((o) => {
      const m = (minor: number) => money(minor, o.currency, market);
      const reached = o.net - o.refund_debit;
      return {
        order_id: o.id,
        date: o.at.toISOString(),
        status: o.status,
        seller: o.seller.name,
        seller_id: o.seller.id,
        seller_country: o.seller.country,
        market: o.locale,
        items: o.lines.map((l) => (l.quantity > 1 ? `${l.title} ×${l.quantity}` : l.title)).join(", "),
        image_url: o.lines[0]?.image_url ?? null,
        units: o.lines.reduce((s, l) => s + l.quantity, 0),
        total: m(o.gross),
        refunded: m(o.refunded),
        fees: m(o.captured ? o.gross - o.net : 0),
        reached_maker: m(o.captured ? Math.max(0, reached) : 0),
        reached_maker_bps: o.captured ? ratioBps(Math.max(0, reached), o.gross) : 0,
        conversation_id: threads.find((t) => t.order_id === o.id)?.id ?? null,
      };
    }),
  };
}

export async function buyerOverview(buyerId: string, market: string, now = new Date()) {
  const ref = getMarket(market).currency;
  const orders = (await loadOrders({ buyer_id: buyerId })).filter((o) => o.captured);
  const m = (minor: number) => money(minor, ref, market);
  const h = (o: OrderFacts, minor: number) => convertAtReference(minor, o.currency, ref);

  const spent = orders.reduce((s, o) => s + h(o, o.gross - o.refunded), 0);
  const reached = orders.reduce((s, o) => s + h(o, Math.max(0, o.net - o.refund_debit)), 0);
  const months = lastMonthKeys(now, 6).map((key) => {
    const os = orders.filter((o) => monthKey(o.at) === key);
    const byGroup: Record<string, number> = {};
    for (const o of os) {
      const g = CURRENCY_GROUPS.includes(o.currency as (typeof CURRENCY_GROUPS)[number]) ? o.currency : "OTHER";
      byGroup[g] = (byGroup[g] ?? 0) + h(o, o.gross - o.refunded);
    }
    return { month: key, ...monthProgress(key, now), orders: os.length, spent: m(os.reduce((s, o) => s + h(o, o.gross - o.refunded), 0)), spent_by_currency: byGroup };
  });

  const bySeller = new Map<string, { seller_id: string; seller: string; country: string; orders: number; spent: number; last: Date }>();
  for (const o of orders) {
    const a = bySeller.get(o.seller.id) ?? { seller_id: o.seller.id, seller: o.seller.name, country: o.seller.country, orders: 0, spent: 0, last: o.at };
    a.orders += 1;
    a.spent += h(o, o.gross - o.refunded);
    if (o.at > a.last) a.last = o.at;
    bySeller.set(o.seller.id, a);
  }
  const byCurrency = new Map<string, number>();
  for (const o of orders) byCurrency.set(o.currency, (byCurrency.get(o.currency) ?? 0) + o.gross - o.refunded);

  // Popular in the buyer's market over the last 90 days, excluding products already bought.
  const bought = new Set(orders.flatMap((o) => o.lines.map((l) => l.product_id)));
  const popular = await prisma.orderItem.groupBy({
    by: ["listing_id"],
    where: { order: { locale: market, status: { in: [...CAPTURED] }, paid_at: { gte: new Date(now.getTime() - 90 * DAY) } } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 30,
  });
  const listings = await prisma.listing.findMany({
    where: { id: { in: popular.map((p) => p.listing_id) }, status: "PUBLISHED" },
    include: { product: { select: { id: true, image_url: true, rating_avg: true } }, seller: { select: { name: true, country: true } } },
  });
  let picks = popular
    .map((p) => listings.find((l) => l.id === p.listing_id))
    .filter((l): l is (typeof listings)[number] => Boolean(l) && !bought.has(l!.product.id));
  if (picks.length < 4) {
    // Not enough recent sellers in this market: fall back to the best-rated listings not yet bought.
    const more = await prisma.listing.findMany({
      where: { locale: market, status: "PUBLISHED", product: { id: { notIn: [...bought] } }, id: { notIn: picks.map((l) => l.id) } },
      include: { product: { select: { id: true, image_url: true, rating_avg: true } }, seller: { select: { name: true, country: true } } },
      orderBy: { product: { rating_avg: { sort: "desc", nulls: "last" } } },
      take: 4 - picks.length,
    });
    picks = [...picks, ...more];
  }
  const recommendations = picks
    .slice(0, 4)
    .map((l) => ({
      listing_id: l.id,
      title: l.title,
      seller: l.seller.name,
      seller_country: l.seller.country,
      price: money(l.price_minor, l.currency, market),
      image_url: l.product.image_url,
      rating: l.product.rating_avg,
    }));

  const unread = await prisma.conversation.aggregate({ where: { buyer_id: buyerId }, _sum: { buyer_unread: true } });

  return {
    reference_currency: ref,
    kpis: {
      orders: orders.length,
      spent: m(spent),
      reached_makers: m(reached),
      reached_bps: ratioBps(reached, spent),
      makers: bySeller.size,
      countries: new Set(orders.map((o) => o.seller.country)).size,
      refunds: orders.filter((o) => o.refunded > 0).length,
      unread_messages: unread._sum.buyer_unread ?? 0,
    },
    monthly: months,
    by_currency: [...byCurrency.entries()].map(([currency, minor]) => ({ currency, spent: money(minor, currency, market) })).sort((a, b) => b.spent.amount_minor - a.spent.amount_minor),
    makers: [...bySeller.values()]
      .sort((a, b) => b.spent - a.spent)
      .map((a) => ({ seller_id: a.seller_id, seller: a.seller, country: a.country, orders: a.orders, spent: m(a.spent), last_order: a.last.toISOString() })),
    recommendations,
    reference_rates_note: `Totals in ${ref} use fixed reference exchange rates; each order was paid in its own currency.`,
  };
}

// --- Seller: operations --------------------------------------------------------------------

/**
 * Week by week (oldest first, the last one ending now): how many paid orders
 * were refunded and how many orders ended with a failed payment. Orders count
 * in the week they were placed or paid, the same date the dashboards use.
 */
export async function opsTrend(sellerId: string, weeks = 12, now = new Date()) {
  const orders = await loadOrders({ seller_id: sellerId });
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    week_start: new Date(now.getTime() - (weeks - i) * 7 * DAY).toISOString().slice(0, 10),
    orders: 0,
    refunded_orders: 0,
    declined: 0,
  }));
  for (const o of orders) {
    const i = weekIndex(o.at, now, weeks);
    const b = i >= 0 ? buckets[i] : undefined;
    if (!b) continue;
    if (o.captured) {
      b.orders += 1;
      if (o.refund_debit > 0) b.refunded_orders += 1;
    } else if (o.status === "PENDING_PAYMENT") b.declined += 1;
  }
  return { weeks: buckets.map((b) => ({ ...b, refund_rate_bps: b.orders > 0 ? ratioBps(b.refunded_orders, b.orders) : null })) };
}

/**
 * What needs doing about orders: anomaly checks, buyers waiting on a reply,
 * proposals waiting for approval, and order counts by status for the period.
 */
export async function operationsSummary(sellerId: string, period: Period, now = new Date()) {
  const seller = await sellerOrFail(sellerId);
  const [orders, anomalies, waiting, approvals] = await Promise.all([
    loadOrders({ seller_id: sellerId }),
    detectAnomalies(sellerId, seller.locale, now),
    prisma.conversation.findMany({
      where: { seller_id: sellerId, seller_unread: { gt: 0 } },
      select: { id: true, subject: true, buyer: { select: { name: true } } },
      orderBy: { last_message_at: "desc" },
    }),
    prisma.agentAction.count({ where: { seller_id: sellerId, status: "PENDING_APPROVAL" } }),
  ]);
  const current = orders.filter((o) => inPeriod(o.at, period));
  const counts: Record<string, number> = { PAID: 0, PARTIALLY_REFUNDED: 0, REFUNDED: 0, PENDING_PAYMENT: 0 };
  for (const o of current) counts[o.status] = (counts[o.status] ?? 0) + 1;
  const refundableOrders = current.filter((o) => o.captured && o.gross - o.refunded > 0).length;
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  const trend = await opsTrend(sellerId, 12, now);
  return {
    period: { label: period.label },
    trend: trend.weeks,
    status_counts: counts,
    refundable_orders: refundableOrders,
    waiting_threads: waiting.map((w) => ({ id: w.id, subject: w.subject, buyer: w.buyer.name })),
    pending_approvals: approvals,
    anomalies: [...anomalies.anomalies]
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
      // Fee spikes are per order; fold them into one line so the list stays readable.
      .reduce<{ type: string; severity: "low" | "medium" | "high"; summary: string; count: number; order_id: string | null }[]>((acc, a) => {
        const orderId = typeof a.evidence.order_id === "string" ? a.evidence.order_id : null;
        const same = a.type === "fee_spike" ? acc.find((x) => x.type === "fee_spike") : undefined;
        if (same) {
          same.count += 1;
          same.summary = `${same.count} orders paid a PayPal fee well above your usual rate.`;
          same.order_id = null;
        } else acc.push({ type: a.type, severity: a.severity, summary: a.summary, count: 1, order_id: orderId });
        return acc;
      }, []),
  };
}

// --- Public: landing page ---------------------------------------------------------------------

/**
 * Marketplace-wide aggregates for the public home page. Contains no buyer
 * data and nothing per order: only counts, sums at reference rates in USD,
 * and one featured published listing per maker.
 */
export async function marketplaceStats(now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const [sellers, buyers, payments, refunds, listings, markets] = await Promise.all([
    prisma.seller.findMany({ select: { id: true, name: true, country: true, locale: true } }),
    prisma.buyer.count(),
    prisma.payment.findMany({
      where: { status: "COMPLETED", captured_at: { gte: since } },
      select: { currency: true, gross_minor: true, paypal_fee_minor: true, platform_fee_minor: true, fx_cost_minor: true },
    }),
    prisma.refund.findMany({ where: { status: { in: ["PENDING", "COMPLETED"] }, created_at: { gte: since } }, select: { currency: true, seller_debit_minor: true } }),
    prisma.listing.findMany({
      where: { status: "PUBLISHED", locale: "en-US" },
      select: { id: true, title: true, price_minor: true, currency: true, seller_id: true, product: { select: { image_url: true, rating_avg: true, category: true } } },
    }),
    prisma.listing.groupBy({ by: ["locale"], where: { status: "PUBLISHED" } }),
  ]);
  const usd = (minor: number, currency: string) => convertAtReference(minor, currency, "USD");
  const t = { gross: 0, paypal: 0, platform: 0, fx: 0, refunds: 0 };
  for (const p of payments) {
    t.gross += usd(p.gross_minor, p.currency);
    t.paypal += usd(p.paypal_fee_minor ?? 0, p.currency);
    t.platform += usd(p.platform_fee_minor ?? 0, p.currency);
    t.fx += usd(p.fx_cost_minor ?? 0, p.currency);
  }
  for (const r of refunds) t.refunds += usd(r.seller_debit_minor ?? 0, r.currency);
  const net = t.gross - t.paypal - t.platform - t.fx - t.refunds;
  const share = (v: number) => ratioBps(v, t.gross);

  const featured = sellers
    .map((s) => {
      const best = listings.filter((l) => l.seller_id === s.id).sort((a, b) => (b.product.rating_avg ?? 0) - (a.product.rating_avg ?? 0))[0];
      return best
        ? {
            listing_id: best.id,
            title: best.title,
            category: best.product.category,
            image_url: best.product.image_url,
            price: money(best.price_minor, best.currency, "en-US"),
            maker: s.name,
            country: s.country,
            maker_locale: s.locale,
          }
        : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  return {
    makers: sellers.length,
    buyers,
    markets: markets.length,
    orders_90d: payments.length,
    sales_90d: money(t.gross, "USD", "en-US"),
    anatomy_bps: { net: share(net), paypal: share(t.paypal), platform: share(t.platform), fx: share(t.fx), refunds: share(t.refunds) },
    featured,
  };
}
