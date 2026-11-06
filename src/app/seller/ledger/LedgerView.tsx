"use client";

import type { ColDef } from "ag-grid-community";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Money as MoneyT } from "@/components/api";
import { Grid } from "@/components/grid/Grid";
import { bpsCol, countCol, countryCol, dateCol, feeBarCol, marketCol, moneyCol, productCol, sparkCol, statusCol, threadCol } from "@/components/grid/columns";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/components/PeriodPicker";
import { MarketStamp } from "@/components/ui";
import { formatBps } from "@/lib/format";
import { OrderDrawer } from "./OrderDrawer";

export type LedgerTab = "sales" | "products" | "buyers" | "markets";

type SaleRow = {
  order_id: string;
  date: string;
  status: string;
  buyer: string;
  buyer_country: string;
  market: string;
  currency: string;
  items: string;
  units: number;
  image_url: string | null;
  gross: MoneyT;
  paypal_fee: MoneyT;
  platform_fee: MoneyT;
  fx_cost: MoneyT;
  refunded: MoneyT;
  net: MoneyT;
  net_home: MoneyT;
  fee_is_estimate: boolean;
  failure_reason: string | null;
  conversation_id: string | null;
};
type ProductRow = {
  product_id: string;
  sku: string;
  title: string;
  category: string | null;
  image_url: string | null;
  markets: string[];
  drafts: number;
  price_from: MoneyT | null;
  stock: number;
  rating: number | null;
  rating_count: number;
  views: number;
  cart_adds: number;
  orders: number;
  units: number;
  conversion_bps: number;
  refund_rate_bps: number;
  gross_home: MoneyT;
  net_home: MoneyT;
  weekly_units: number[];
};
type BuyerRow = {
  buyer_id: string;
  buyer: string;
  country: string;
  markets: string[];
  orders: number;
  units: number;
  net_home: MoneyT;
  avg_order_home: MoneyT;
  refunds: number;
  last_order: string | null;
  threads: number;
  unread: number;
};
type MarketRow = {
  market: string;
  currency: string;
  orders: number;
  gross_sales: MoneyT;
  paypal_fees: MoneyT;
  platform_fees: MoneyT;
  fx_costs: MoneyT;
  net_earnings: MoneyT;
  refunds: number;
  refund_debits: MoneyT;
  net_after_refunds: MoneyT;
};

const TAB_LABEL: Record<LedgerTab, string> = { sales: "Sales", products: "Products", buyers: "Buyers", markets: "Markets" };
const TAB_INTRO: Record<LedgerTab, string> = {
  sales: "Every order, in the currency the buyer paid. Click a row for fees, refunds and the buyer thread.",
  products: "How each product turns listing views into orders, across every market it is listed in.",
  buyers: "Who buys from you, how often, and whether a conversation needs an answer.",
  markets: "Earnings per market and currency, with PayPal, platform and conversion costs.",
};

const sumMoney = (rows: { amount_minor: number; currency: string }[], fallbackCurrency: string, display: (minor: number) => string): MoneyT => {
  const amount = rows.reduce((s, r) => s + r.amount_minor, 0);
  return { amount_minor: amount, currency: rows[0]?.currency ?? fallbackCurrency, display: display(amount) };
};

function moneyFormatter(currency: string, locale: string) {
  const exp = currency === "JPY" ? 0 : 2;
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp });
  return (minor: number) => nf.format(minor / 10 ** exp);
}

function Legend() {
  const items = [
    ["var(--series-1)", "Reached you"],
    ["var(--series-2)", "PayPal"],
    ["var(--series-3)", "Platform"],
    ["var(--series-4)", "Conversion"],
    ["var(--series-5)", "Refunds"],
  ] as const;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3" aria-label="Where it went, colour key">
      {items.map(([c, l]) => (
        <li key={l} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[1px]" style={{ background: c }} aria-hidden />
          {l}
        </li>
      ))}
    </ul>
  );
}

export function LedgerView({ period, tab }: { period: DashboardPeriod; tab: LedgerTab }) {
  type Loaded = { key: string; sales?: SaleRow[]; products?: ProductRow[]; buyers?: BuyerRow[]; markets?: MarketRow[]; error?: string };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [openOrder, setOpenOrder] = useState<SaleRow | null>(null);
  const [viewLocale, setViewLocale] = useState("en-US");
  const key = `${tab}|${period}`;
  const current = loaded?.key === key ? loaded : null;
  const sales = current?.sales ?? null;
  const products = current?.products ?? null;
  const buyers = current?.buyers ?? null;
  const markets = current?.markets ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    const k = `${tab}|${period}`;
    const fail = (e: unknown) => setLoaded({ key: k, error: e instanceof Error ? e.message : "The ledger could not be loaded." });
    if (tab === "sales") {
      api<{ rows: SaleRow[]; view_locale: string }>(`/api/analytics/seller/sales?period=${period}`).then((r) => {
        setViewLocale(r.view_locale);
        setLoaded({ key: k, sales: r.rows });
      }, fail);
    } else if (tab === "products") {
      api<{ rows: ProductRow[]; view_locale: string }>(`/api/analytics/seller/products?period=${period}`).then((r) => {
        setViewLocale(r.view_locale);
        setLoaded({ key: k, products: r.rows });
      }, fail);
    } else if (tab === "buyers") {
      api<{ rows: BuyerRow[] }>(`/api/analytics/seller/buyers?period=${period}`).then((r) => setLoaded({ key: k, buyers: r.rows }), fail);
    } else {
      api<{ markets: MarketRow[] }>(`/api/earnings?period=${period}`).then((r) => setLoaded({ key: k, markets: r.markets }), fail);
    }
  }, [tab, period]);

  const salesCols = useMemo<ColDef<SaleRow>[]>(
    () => [
      productCol<SaleRow>("items", "image_url", (r) => `${r.units} ${r.units === 1 ? "item" : "items"}, order ${r.order_id.slice(0, 8)}`, { headerName: "Order" }),
      dateCol<SaleRow>("date", "Date", { sort: "desc" }),
      statusCol<SaleRow>("status"),
      { field: "buyer", headerName: "Buyer", width: 160 },
      countryCol<SaleRow>("buyer_country", "Ships to"),
      marketCol<SaleRow>("market"),
      moneyCol<SaleRow>("gross", "Paid by buyer"),
      moneyCol<SaleRow>("paypal_fee", "PayPal fee", { tone: "fee", estimateField: "fee_is_estimate" }),
      moneyCol<SaleRow>("platform_fee", "Platform fee", { tone: "fee" }),
      moneyCol<SaleRow>("fx_cost", "Conversion", { tone: "fee" }),
      moneyCol<SaleRow>("refunded", "Refunded", { tone: "fee" }),
      moneyCol<SaleRow>("net", "Reached you", { tone: "net", width: 140 }),
      moneyCol<SaleRow>("net_home", "In home currency", { tone: "muted", width: 150, headerTooltip: "Converted at fixed reference rates" }),
      feeBarCol<SaleRow>((r) =>
        r.status === "PENDING_PAYMENT"
          ? null
          : {
              gross: r.gross.amount_minor,
              net: r.net.amount_minor,
              paypal: r.paypal_fee.amount_minor,
              platform: r.platform_fee.amount_minor,
              fx: r.fx_cost.amount_minor,
              refund: r.gross.amount_minor - r.paypal_fee.amount_minor - r.platform_fee.amount_minor - r.fx_cost.amount_minor - r.net.amount_minor,
            },
      ),
      threadCol<SaleRow>("conversation_id", (id) => `/seller/messages?c=${id}`),
    ],
    [],
  );

  const productCols = useMemo<ColDef<ProductRow>[]>(
    () => [
      productCol<ProductRow>("title", "image_url", (r) => (r.category ? `${r.category}, ${r.sku}` : r.sku)),
      {
        field: "markets",
        headerName: "Listed in",
        width: 120,
        valueGetter: (p) => (p.node?.rowPinned ? null : (p.data?.markets?.length ?? 0)),
        cellRenderer: (p: { data?: ProductRow; node: { rowPinned?: string | null } }) =>
          p.data && !p.node.rowPinned ? (
            <span title={p.data.markets.join(", ")}>
              {p.data.markets.length} markets{p.data.drafts > 0 ? <span className="text-gold-ink">, {p.data.drafts} draft</span> : null}
            </span>
          ) : null,
        getQuickFilterText: (p) => (p.data?.markets ?? []).join(" "),
      },
      moneyCol<ProductRow>("price_from", "Price from", { width: 120 }),
      countCol<ProductRow>("stock", "Stock", {
        cellRenderer: (p: { value?: number; node: { rowPinned?: string | null } }) =>
          p.node.rowPinned || p.value === undefined ? null : p.value === 0 ? <span className="font-semibold text-alert-ink">Sold out</span> : p.value < 10 ? <span className="text-gold-ink">{p.value} left</span> : <span className="num">{p.value}</span>,
      }),
      {
        field: "rating",
        headerName: "Rating",
        type: "rightAligned",
        width: 110,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => (typeof p.value === "number" ? `${p.value.toFixed(1)} (${p.data?.rating_count ?? 0})` : ""),
        cellClass: ["num", "ag-right-aligned-cell"],
      },
      countCol<ProductRow>("views", "Views"),
      countCol<ProductRow>("cart_adds", "Added to cart", { width: 130 }),
      countCol<ProductRow>("orders", "Orders"),
      countCol<ProductRow>("units", "Units"),
      bpsCol<ProductRow>("conversion_bps", "Conversion", { digits: 2 }),
      bpsCol<ProductRow>("refund_rate_bps", "Refunded", {
        cellClassRules: { "text-alert-ink font-semibold": (p) => typeof p.value === "number" && p.value >= 1500 },
      }),
      moneyCol<ProductRow>("net_home", "Net earned", { tone: "net", width: 140 }),
      sparkCol<ProductRow>("weekly_units", "12-week trend", (r) => `Weekly units for ${r.title}`),
    ],
    [],
  );

  const buyerCols = useMemo<ColDef<BuyerRow>[]>(
    () => [
      { field: "buyer", headerName: "Buyer", pinned: "left", lockPinned: true, lockVisible: true, width: 180, cellClass: "font-medium" },
      countryCol<BuyerRow>("country"),
      {
        field: "markets",
        headerName: "Shops in",
        width: 180,
        cellRenderer: (p: { value?: string[] }) => (
          <span className="flex h-full items-center gap-1.5">
            {(p.value ?? []).map((m) => (
              <MarketStamp key={m} locale={m} showLanguage={false} />
            ))}
          </span>
        ),
        getQuickFilterText: (p) => ((p.value as string[] | undefined) ?? []).join(" "),
      },
      countCol<BuyerRow>("orders", "Orders", { sort: "desc" }),
      countCol<BuyerRow>("units", "Units"),
      moneyCol<BuyerRow>("net_home", "Net earned", { tone: "net", width: 140 }),
      moneyCol<BuyerRow>("avg_order_home", "Per order", { width: 120 }),
      countCol<BuyerRow>("refunds", "Refunds"),
      dateCol<BuyerRow>("last_order", "Last order"),
      {
        field: "unread",
        headerName: "Messages",
        width: 150,
        cellRenderer: (p: { data?: BuyerRow }) =>
          p.data ? (
            p.data.unread > 0 ? (
              <Link href="/seller/messages" className="font-semibold text-alert-ink hover:underline">
                {p.data.unread} waiting on you
              </Link>
            ) : (
              <span className="text-ink-3">{p.data.threads ? `${p.data.threads} threads` : "None"}</span>
            )
          ) : null,
      },
    ],
    [],
  );

  const marketCols = useMemo<ColDef<MarketRow>[]>(
    () => [
      marketCol<MarketRow>("market", "Market", { pinned: "left", lockPinned: true, width: 170 }),
      { field: "currency", headerName: "Currency", width: 110 },
      countCol<MarketRow>("orders", "Orders", { sort: "desc" }),
      moneyCol<MarketRow>("gross_sales", "Sales"),
      moneyCol<MarketRow>("paypal_fees", "PayPal fees", { tone: "fee" }),
      moneyCol<MarketRow>("platform_fees", "Platform fees", { tone: "fee" }),
      moneyCol<MarketRow>("fx_costs", "Conversion", { tone: "fee" }),
      moneyCol<MarketRow>("net_earnings", "Net"),
      countCol<MarketRow>("refunds", "Refunds"),
      moneyCol<MarketRow>("refund_debits", "Refund cost", { tone: "fee" }),
      moneyCol<MarketRow>("net_after_refunds", "Reached you", { tone: "net", width: 140 }),
    ],
    [],
  );

  const salesTotals = useCallback((rows: SaleRow[]): Partial<SaleRow> | null => {
    const first = rows[0];
    if (!first) return null;
    const fmt = moneyFormatter(first.net_home.currency, viewLocale);
    return { order_id: "__total", items: `Total, ${rows.length} orders`, net_home: sumMoney(rows.map((r) => r.net_home), first.net_home.currency, fmt) };
  }, [viewLocale]);
  const productTotals = useCallback((rows: ProductRow[]): Partial<ProductRow> | null => {
    const first = rows[0];
    if (!first) return null;
    const fmt = moneyFormatter(first.net_home.currency, viewLocale);
    return {
      product_id: "__total",
      title: `Total, ${rows.length} products`,
      views: rows.reduce((s, r) => s + r.views, 0),
      cart_adds: rows.reduce((s, r) => s + r.cart_adds, 0),
      orders: rows.reduce((s, r) => s + r.orders, 0),
      units: rows.reduce((s, r) => s + r.units, 0),
      net_home: sumMoney(rows.map((r) => r.net_home), first.net_home.currency, fmt),
    };
  }, [viewLocale]);

  const periodLabel = DASHBOARD_PERIODS.find((p) => p.key === period)?.label ?? "";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">Sales ledger</h1>
          <p className="mt-1 text-ink-3">{TAB_INTRO[tab]}</p>
        </div>
        <nav aria-label="Period" className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
          {DASHBOARD_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/seller/ledger?tab=${tab}&period=${p.key}`}
              scroll={false}
              aria-current={p.key === period ? "true" : undefined}
              className={`inline-flex min-h-10 items-center rounded-[5px] px-3 text-sm ${p.key === period ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2"}`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      <nav aria-label="Ledger views" className="-mb-px flex gap-1 overflow-x-auto border-b border-rule">
        {(Object.keys(TAB_LABEL) as LedgerTab[]).map((t) => (
          <Link
            key={t}
            href={`/seller/ledger?tab=${t}&period=${period}`}
            scroll={false}
            aria-current={t === tab ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-4 text-[0.95rem] ${t === tab ? "border-accent font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}

      {tab === "sales" && (
        <Grid<SaleRow>
          label={`Sales, ${periodLabel}`}
          storageKey="seller-sales-v1"
          rowData={sales}
          columnDefs={salesCols}
          getRowId={(r) => r.order_id}
          onRowClicked={(r) => setOpenOrder(r)}
          totals={salesTotals}
          exportName={`sales-${period}`}
          searchHint="buyer, product, market or status"
          emptyMessage="No orders in this period. Try a longer period."
          rowHeight={52}
          toolbar={<Legend />}
        />
      )}
      {tab === "products" && (
        <Grid<ProductRow>
          label={`Products, ${periodLabel}`}
          storageKey="seller-products-v1"
          rowData={products}
          columnDefs={productCols}
          getRowId={(r) => r.product_id}
          totals={productTotals}
          exportName={`products-${period}`}
          searchHint="product, SKU, category or market"
          emptyMessage="No products yet. Add one from the Products page."
          rowHeight={52}
        />
      )}
      {tab === "buyers" && (
        <Grid<BuyerRow>
          label={`Buyers, ${periodLabel}`}
          storageKey="seller-buyers-v1"
          rowData={buyers}
          columnDefs={buyerCols}
          getRowId={(r) => r.buyer_id}
          exportName={`buyers-${period}`}
          searchHint="buyer, country or market"
          emptyMessage="No buyers in this period."
        />
      )}
      {tab === "markets" && (
        <Grid<MarketRow>
          label={`Markets, ${periodLabel}`}
          storageKey="seller-markets-v1"
          rowData={markets}
          columnDefs={marketCols}
          getRowId={(r) => `${r.market}-${r.currency}`}
          exportName={`markets-${period}`}
          searchHint="market or currency"
          emptyMessage="No sales in this period."
        />
      )}
      {tab === "products" && products && (
        <p className="text-xs text-ink-3">
          Conversion is orders divided by listing views. A refund rate of {formatBps(1500, 0)} or more is highlighted.
        </p>
      )}

      <OrderDrawer row={openOrder} onClose={() => setOpenOrder(null)} />
    </div>
  );
}
