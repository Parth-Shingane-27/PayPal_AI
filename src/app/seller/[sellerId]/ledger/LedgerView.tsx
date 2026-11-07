"use client";

import type { ColDef } from "ag-grid-community";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Money as MoneyT } from "@/components/api";
import { Grid } from "@/components/grid/Grid";
import { bpsCol, countCol, countryCol, dateCol, feeBarCol, marketCol, moneyCol, productCol, sparkCol, statusCol, threadCol } from "@/components/grid/columns";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useBase } from "@/lib/use-base";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/periods";
import type { MessageKey } from "@/lib/i18n/messages";
import { MarketStamp } from "@/components/ui";
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

const TABS: LedgerTab[] = ["sales", "products", "buyers", "markets"];


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
  const { t } = useI18n();
  const items = [
    ["var(--series-1)", t("chart.reachedYou")],
    ["var(--series-2)", t("chart.paypal")],
    ["var(--series-3)", t("chart.platform")],
    ["var(--series-4)", t("chart.conversion")],
    ["var(--series-5)", t("chart.refunds")],
  ] as const;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3" aria-label={t("ledger.legend")}>
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
  const { t, locale } = useI18n();
  const base = useBase();
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
    const fail = (e: unknown) => setLoaded({ key: k, error: e instanceof Error ? e.message : t("ledger.error") });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period]);

  const salesCols = useMemo<ColDef<SaleRow>[]>(
    () => [
      productCol<SaleRow>("items", "image_url", (r) => `${r.units === 1 ? t("cell.item") : t("cell.items", { n: r.units })}, ${t("cell.orderShort", { id: r.order_id.slice(0, 8) })}`, { headerName: t("col.order") }),
      dateCol<SaleRow>("date", t("col.date"), { sort: "desc", locale }),
      statusCol<SaleRow>("status", t),
      { field: "buyer", headerName: t("col.buyer"), width: 160 },
      countryCol<SaleRow>("buyer_country", t("col.shipsTo")),
      marketCol<SaleRow>("market", t("col.market")),
      moneyCol<SaleRow>("gross", t("col.paidByBuyer")),
      moneyCol<SaleRow>("paypal_fee", t("col.paypalFee"), { tone: "fee", estimateField: "fee_is_estimate" }),
      moneyCol<SaleRow>("platform_fee", t("col.platformFee"), { tone: "fee" }),
      moneyCol<SaleRow>("fx_cost", t("col.conversion"), { tone: "fee" }),
      moneyCol<SaleRow>("refunded", t("col.refunded"), { tone: "fee" }),
      moneyCol<SaleRow>("net", t("col.reachedYou"), { tone: "net", width: 140 }),
      moneyCol<SaleRow>("net_home", t("col.homeCurrency"), { tone: "muted", width: 150 }),
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
        t,
      ),
      threadCol<SaleRow>("conversation_id", (id) => `${base}/messages?c=${id}`, t),
    ],
    [t, locale, base],
  );

  const productCols = useMemo<ColDef<ProductRow>[]>(
    () => [
      productCol<ProductRow>("title", "image_url", (r) => (r.category ? `${r.category}, ${r.sku}` : r.sku), { headerName: t("col.product") }),
      {
        field: "markets",
        headerName: t("col.listedIn"),
        width: 120,
        valueGetter: (p) => (p.node?.rowPinned ? null : (p.data?.markets?.length ?? 0)),
        cellRenderer: (p: { data?: ProductRow; node: { rowPinned?: string | null } }) =>
          p.data && !p.node.rowPinned ? (
            <span title={p.data.markets.join(", ")}>
              {t("cell.markets", { n: p.data.markets.length })}{p.data.drafts > 0 ? <span className="text-gold-ink">, {t("cell.drafts", { n: p.data.drafts })}</span> : null}
            </span>
          ) : null,
        getQuickFilterText: (p) => (p.data?.markets ?? []).join(" "),
      },
      moneyCol<ProductRow>("price_from", t("col.priceFrom"), { width: 120 }),
      countCol<ProductRow>("stock", t("col.stock"), {
        cellRenderer: (p: { value?: number; node: { rowPinned?: string | null } }) =>
          p.node.rowPinned || p.value === undefined ? null : p.value === 0 ? <span className="font-semibold text-alert-ink">{t("cell.soldOut")}</span> : p.value < 10 ? <span className="text-gold-ink">{t("cell.left", { n: p.value })}</span> : <span className="num">{p.value}</span>,
      }),
      {
        field: "rating",
        headerName: t("col.rating"),
        type: "rightAligned",
        width: 110,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => (typeof p.value === "number" ? `${p.value.toFixed(1)} (${p.data?.rating_count ?? 0})` : ""),
        cellClass: ["num", "ag-right-aligned-cell"],
      },
      countCol<ProductRow>("views", t("col.views")),
      countCol<ProductRow>("cart_adds", t("col.cartAdds"), { width: 130 }),
      countCol<ProductRow>("orders", t("col.orders")),
      countCol<ProductRow>("units", t("col.units")),
      bpsCol<ProductRow>("conversion_bps", t("col.conversion"), { digits: 2 }),
      bpsCol<ProductRow>("refund_rate_bps", t("col.refunded"), {
        cellClassRules: { "text-alert-ink font-semibold": (p) => typeof p.value === "number" && p.value >= 1500 },
      }),
      moneyCol<ProductRow>("net_home", t("col.netEarned"), { tone: "net", width: 140 }),
      sparkCol<ProductRow>("weekly_units", t("col.trend"), (r) => t("best.weekly", { title: r.title })),
    ],
    [t],
  );

  const buyerCols = useMemo<ColDef<BuyerRow>[]>(
    () => [
      { field: "buyer", headerName: t("col.buyer"), pinned: "left", lockPinned: true, lockVisible: true, width: 180, cellClass: "font-medium" },
      countryCol<BuyerRow>("country", t("col.country")),
      {
        field: "markets",
        headerName: t("col.shopsIn"),
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
      countCol<BuyerRow>("orders", t("col.orders"), { sort: "desc" }),
      countCol<BuyerRow>("units", t("col.units")),
      moneyCol<BuyerRow>("net_home", t("col.netEarned"), { tone: "net", width: 140 }),
      moneyCol<BuyerRow>("avg_order_home", t("col.perOrder"), { width: 120 }),
      countCol<BuyerRow>("refunds", t("col.refunds")),
      dateCol<BuyerRow>("last_order", t("col.lastOrder"), { locale }),
      {
        field: "unread",
        headerName: t("col.messages"),
        width: 150,
        cellRenderer: (p: { data?: BuyerRow }) =>
          p.data ? (
            p.data.unread > 0 ? (
              <Link href={`${base}/messages`} className="font-semibold text-alert-ink hover:underline">
                {t("cell.waiting", { n: p.data.unread })}
              </Link>
            ) : (
              <span className="text-ink-3">{p.data.threads ? t("cell.threads", { n: p.data.threads }) : t("cell.none")}</span>
            )
          ) : null,
      },
    ],
    [t, locale, base],
  );

  const marketCols = useMemo<ColDef<MarketRow>[]>(
    () => [
      marketCol<MarketRow>("market", t("col.market"), { pinned: "left", lockPinned: true, width: 170 }),
      { field: "currency", headerName: t("col.currency"), width: 110 },
      countCol<MarketRow>("orders", t("col.orders"), { sort: "desc" }),
      moneyCol<MarketRow>("gross_sales", t("col.sales")),
      moneyCol<MarketRow>("paypal_fees", t("col.paypalFees"), { tone: "fee" }),
      moneyCol<MarketRow>("platform_fees", t("col.platformFees"), { tone: "fee" }),
      moneyCol<MarketRow>("fx_costs", t("col.conversion"), { tone: "fee" }),
      moneyCol<MarketRow>("net_earnings", t("col.net")),
      countCol<MarketRow>("refunds", t("col.refunds")),
      moneyCol<MarketRow>("refund_debits", t("col.refundCost"), { tone: "fee" }),
      moneyCol<MarketRow>("net_after_refunds", t("col.reachedYou"), { tone: "net", width: 140 }),
    ],
    [t],
  );

  const salesTotals = useCallback((rows: SaleRow[]): Partial<SaleRow> | null => {
    const first = rows[0];
    if (!first) return null;
    const fmt = moneyFormatter(first.net_home.currency, viewLocale);
    return { order_id: "__total", items: t("grid.total", { n: rows.length, what: t("ledger.what.orders") }), net_home: sumMoney(rows.map((r) => r.net_home), first.net_home.currency, fmt) };
  }, [viewLocale, t]);
  const productTotals = useCallback((rows: ProductRow[]): Partial<ProductRow> | null => {
    const first = rows[0];
    if (!first) return null;
    const fmt = moneyFormatter(first.net_home.currency, viewLocale);
    return {
      product_id: "__total",
      title: t("grid.total", { n: rows.length, what: t("ledger.what.products") }),
      views: rows.reduce((s, r) => s + r.views, 0),
      cart_adds: rows.reduce((s, r) => s + r.cart_adds, 0),
      orders: rows.reduce((s, r) => s + r.orders, 0),
      units: rows.reduce((s, r) => s + r.units, 0),
      net_home: sumMoney(rows.map((r) => r.net_home), first.net_home.currency, fmt),
    };
  }, [viewLocale, t]);

  const periodLabel = t(`period.${period}` as MessageKey);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("ledger.title")}</h1>
          <p className="mt-1 text-ink-3">{t(`ledger.intro.${tab}` as MessageKey)}</p>
        </div>
        <nav aria-label={t("period.label")} className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
          {DASHBOARD_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`${base}/ledger?tab=${tab}&period=${p.key}`}
              scroll={false}
              aria-current={p.key === period ? "true" : undefined}
              className={`inline-flex min-h-10 items-center rounded-[5px] px-3 text-sm ${p.key === period ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2"}`}
            >
              {t(`period.${p.key}` as MessageKey)}
            </Link>
          ))}
        </nav>
      </header>

      <nav aria-label={t("ledger.tabs")} className="-mb-px flex gap-1 overflow-x-auto border-b border-rule">
        {TABS.map((tb) => (
          <Link
            key={tb}
            href={`${base}/ledger?tab=${tb}&period=${period}`}
            scroll={false}
            aria-current={tb === tab ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-4 text-[0.95rem] ${tb === tab ? "border-accent font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            {t(`tab.${tb}` as MessageKey)}
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
          label={`${t("tab.sales")}, ${periodLabel}`}
          storageKey="seller-sales-v1"
          rowData={sales}
          columnDefs={salesCols}
          getRowId={(r) => r.order_id}
          onRowClicked={(r) => setOpenOrder(r)}
          totals={salesTotals}
          exportName={`sales-${period}`}
          searchHint={t("ledger.search.sales")}
          emptyMessage={t("ledger.empty.sales")}
          rowHeight={52}
          toolbar={<Legend />}
        />
      )}
      {tab === "products" && (
        <Grid<ProductRow>
          label={`${t("tab.products")}, ${periodLabel}`}
          storageKey="seller-products-v1"
          rowData={products}
          columnDefs={productCols}
          getRowId={(r) => r.product_id}
          totals={productTotals}
          exportName={`products-${period}`}
          searchHint={t("ledger.search.products")}
          emptyMessage={t("ledger.empty.products")}
          rowHeight={52}
        />
      )}
      {tab === "buyers" && (
        <Grid<BuyerRow>
          label={`${t("tab.buyers")}, ${periodLabel}`}
          storageKey="seller-buyers-v1"
          rowData={buyers}
          columnDefs={buyerCols}
          getRowId={(r) => r.buyer_id}
          exportName={`buyers-${period}`}
          searchHint={t("ledger.search.buyers")}
          emptyMessage={t("ledger.empty.buyers")}
        />
      )}
      {tab === "markets" && (
        <Grid<MarketRow>
          label={`${t("tab.markets")}, ${periodLabel}`}
          storageKey="seller-markets-v1"
          rowData={markets}
          columnDefs={marketCols}
          getRowId={(r) => `${r.market}-${r.currency}`}
          exportName={`markets-${period}`}
          searchHint={t("ledger.search.markets")}
          emptyMessage={t("ledger.empty.markets")}
        />
      )}
      {tab === "products" && products && (
        <p className="text-xs text-ink-3">
          {t("ledger.convNote")}
        </p>
      )}

      <OrderDrawer row={openOrder} onClose={() => setOpenOrder(null)} />
    </div>
  );
}
