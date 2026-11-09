"use client";

import type { AgChartOptions } from "ag-charts-community";
import type { MessageKey } from "@/lib/i18n/messages";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../shell/ThemeToggle";
import { formatBps, formatDay, formatMonthKey, formatMonthYear, type MoneyLike } from "@/lib/format";

/** AG Charts renders to canvas in the browser only: loaded with ssr:false. */
const AgChart = dynamic(() => import("./AgChart"), {
  ssr: false,
  loading: () => <div className="h-[300px] w-full animate-pulse rounded-md bg-sheet-2" aria-hidden />,
});

const major = (m: MoneyLike | number, currency: string) => (typeof m === "number" ? m : m.amount_minor) / 10 ** (currency === "JPY" ? 0 : 2);

function moneyFormatter(currency: string, locale: string) {
  const exp = currency === "JPY" ? 0 : 2;
  const full = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp });
  const compact = new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  return { full: (v: number) => full.format(v), compact: (v: number) => compact.format(v), whole: (v: number) => whole.format(v) };
}

/** Visually hidden data table so the numbers are available without the canvas. */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Seller: where each month's sales went ----------------------------------------------

type Progress = { partial?: boolean; days_elapsed?: number; days_in_month?: number };
type SellerMonth = Progress & { month: string; orders: number; net: MoneyLike; paypal_fees: MoneyLike; platform_fees: MoneyLike; fx_costs: MoneyLike; refunds: MoneyLike };

/** A month that is still under way is drawn pale with a dashed outline, so it never reads as a collapse. */
const partialStyle = (p: { datum: Record<string, unknown>; fill?: string }) =>
  p.datum.partial ? { fillOpacity: 0.5, stroke: p.fill, strokeWidth: 1.5, lineDash: [5, 3] } : undefined;

export function SellerMonthlyChart({ months, currency, locale, title }: { months: SellerMonth[]; currency: string; locale: string; title: string }) {
  const { t, locale: uiLocale } = useI18n();
  const fmt = useMemo(() => moneyFormatter(currency, locale), [currency, locale]);
  const [view, setView] = useState<"amount" | "share">("amount");
  const keys = [
    { key: "net", name: t("chart.reachedYou") },
    { key: "paypal_fees", name: t("chart.paypal") },
    { key: "platform_fees", name: t("chart.platform") },
    { key: "fx_costs", name: t("chart.conversion") },
    { key: "refunds", name: t("chart.refunds") },
  ] as const;
  const monthName = (m: SellerMonth) => (m.partial ? `${formatMonthYear(m.month, uiLocale)} ${t("chart.toDateSuffix")}` : formatMonthYear(m.month, uiLocale));
  const options = useMemo<AgChartOptions>(() => {
    const data = months.map((m) => {
      const values = Object.fromEntries(keys.map((k) => [k.key, Math.max(0, major(m[k.key], currency))]));
      return {
        label: m.partial ? t("chart.toDate", { month: formatMonthKey(m.month, uiLocale) }) : formatMonthKey(m.month, uiLocale),
        month: monthName(m),
        orders: m.orders,
        partial: Boolean(m.partial),
        coverage: m.partial ? t("chart.daysOf", { n: m.days_elapsed ?? 0, total: m.days_in_month ?? 0 }) : "",
        total: Object.values(values).reduce((sum, v) => sum + v, 0),
        ...values,
      };
    });
    return {
      data,
      series: keys.map((k) => ({
        type: "bar" as const,
        xKey: "label",
        yKey: k.key,
        yName: k.name,
        stacked: true,
        normalizedTo: view === "share" ? 100 : undefined,
        itemStyler: partialStyle,
        tooltip: {
          renderer: (p: { datum: Record<string, number | string | boolean>; yKey: string }) => {
            const value = Number(p.datum[p.yKey]);
            const total = Number(p.datum.total);
            return {
              heading: String(p.datum.month),
              title: k.name,
              data: [
                { label: t("chart.amount"), value: fmt.full(value) },
                { label: t("chart.shareOfMonth"), value: total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%" },
                { label: t("chart.ordersMonth"), value: String(p.datum.orders) },
                ...(p.datum.partial ? [{ label: t("chart.coverage"), value: String(p.datum.coverage) }] : []),
              ],
            };
          },
        },
      })),
      axes: {
        x: { type: "category", position: "bottom" },
        y: {
          type: "number",
          position: "left",
          label: { formatter: (p: { value: number }) => (view === "share" ? `${p.value}%` : fmt.compact(p.value)) },
        },
      },
    } as AgChartOptions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, currency, fmt, t, uiLocale, view]);

  const finished = months.filter((m) => !m.partial);
  const best = finished.length > 0 ? finished.reduce((a, c) => (c.net.amount_minor > a.net.amount_minor ? c : a)) : null;
  const current = months.find((m) => m.partial);
  const toggle = (v: "amount" | "share", text: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => setView(v)}
      className={`inline-flex min-h-10 cursor-pointer items-center rounded-[5px] px-3 text-sm ${view === v ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2 hover:text-ink"}`}
    >
      {text}
    </button>
  );
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[48ch] text-sm text-ink-3">
          {best ? t("chart.best", { month: formatMonthYear(best.month, uiLocale), amount: best.net.display }) : ""}
          {current ? ` ${t("chart.toDateNote", { month: formatMonthYear(current.month, uiLocale), n: current.days_elapsed ?? 0, total: current.days_in_month ?? 0 })}` : ""}
        </p>
        <div role="group" aria-label={t("chart.view")} className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
          {toggle("amount", t("chart.viewAmount"))}
          {toggle("share", t("chart.viewShare"))}
        </div>
      </div>
      <AgChart options={options} height={320} label={title} />
      <DataTable
        caption={title}
        head={[t("chart.month"), ...keys.map((k) => k.name)]}
        rows={months.map((m) => [monthName(m), ...keys.map((k) => m[k.key].display)])}
      />
    </>
  );
}

// --- Seller: markets, coloured by region ---------------------------------------------------

const REGIONS = ["Americas", "Europe", "Asia-Pacific"] as const;
/** Region colours are chart slots 1-3 (blue, orange, violet), validated as a set. */
const REGION_SLOT: Record<(typeof REGIONS)[number], string> = { Americas: "--series-1", Europe: "--series-2", "Asia-Pacific": "--series-3" };

type MarketRow = { market: string; country: string; region: string; orders: number; refunded_orders?: number; net: MoneyLike; share_bps: number };

export function MarketRegionChart({ markets, currency, locale, href, title }: { markets: MarketRow[]; currency: string; locale: string; href?: string; title: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const mode = useTheme();
  const fmt = useMemo(() => moneyFormatter(currency, locale), [currency, locale]);
  const options = useMemo<AgChartOptions>(() => {
    // The chart itself only draws in the browser; this guard just keeps server rendering from touching `document`.
    const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const token = (name: string) => css?.getPropertyValue(name).trim() ?? "";
    const data: Record<string, string | number>[] = markets.slice(0, 8).map((m) => ({
      label: `${m.country} ${t(`langname.${m.market.slice(0, 2)}` as MessageKey)}`.trim(),
      market: m.market,
      orders: m.orders,
      refunded: m.refunded_orders ?? 0,
      share: m.share_bps / 100,
      ...Object.fromEntries(REGIONS.map((r) => [r, m.region === r ? major(m.net, currency) : 0])),
    }));
    return {
      data,
      legend: { position: "top" },
      series: REGIONS.filter((r) => data.some((d) => (d[r] as number) > 0)).map((r) => ({
        type: "bar" as const,
        direction: "horizontal" as const,
        xKey: "label",
        yKey: r,
        yName: t(`region.${r}` as MessageKey),
        stacked: true,
        fill: token(REGION_SLOT[r]),
        stroke: token(REGION_SLOT[r]),
        label: {
          enabled: true,
          placement: "outside-end",
          formatter: (p: { value: number }) => (p.value > 0 ? fmt.whole(p.value) : ""),
          color: token("--ink-2"),
          fontSize: 12,
        },
        tooltip: {
          renderer: (p: { datum: Record<string, number | string>; yKey: string }) => ({
            heading: String(p.datum.label),
            title: t(`region.${r}` as MessageKey),
            data: [
              { label: t("chart.net"), value: fmt.full(Number(p.datum[p.yKey])) },
              { label: t("chart.orders"), value: String(p.datum.orders) },
              { label: t("chart.share"), value: `${Number(p.datum.share).toFixed(1)}%` },
              { label: t("chart.refundedOrders"), value: t("chart.refundedOf", { n: Number(p.datum.refunded), total: Number(p.datum.orders) }) },
            ],
          }),
        },
        listeners: href ? { nodeClick: () => router.push(href) } : undefined,
        cursor: href ? "pointer" : undefined,
      })),
      axes: {
        y: { type: "category", position: "left" },
        x: { type: "number", position: "bottom", label: { formatter: (p: { value: number }) => fmt.compact(p.value) } },
      },
    } as AgChartOptions;
    // `mode` is a dependency so region colours are re-read after a theme switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets, currency, href, router, fmt, mode, t]);
  if (markets.length === 0) return <p className="text-sm text-ink-3">{t("anat.none")}</p>;
  return (
    <>
      <AgChart options={options} height={Math.max(220, Math.min(8, markets.length) * 40 + 70)} label={title} />
      <DataTable caption={title} head={[t("col.market"), t("chart.region"), t("chart.net"), t("chart.orders")]} rows={markets.map((m) => [m.market, m.region, m.net.display, m.orders])} />
    </>
  );
}

// --- Buyer: spending by month and currency -------------------------------------------------

const CURRENCY_GROUPS = ["USD", "EUR", "GBP", "JPY", "OTHER"] as const;

type BuyerMonth = Progress & { month: string; orders: number; spent: MoneyLike; spent_by_currency: Record<string, number> };

export function BuyerSpendChart({ months, currency, locale, title }: { months: BuyerMonth[]; currency: string; locale: string; title: string }) {
  const { t, locale: uiLocale } = useI18n();
  const fmt = useMemo(() => moneyFormatter(currency, locale), [currency, locale]);
  const options = useMemo<AgChartOptions>(() => {
    const data = months.map((m) => ({
      label: m.partial ? t("chart.toDate", { month: formatMonthKey(m.month, uiLocale) }) : formatMonthKey(m.month, uiLocale),
      month: m.partial ? `${formatMonthYear(m.month, uiLocale)} ${t("chart.toDateSuffix")}` : formatMonthYear(m.month, uiLocale),
      orders: m.orders,
      partial: Boolean(m.partial),
      coverage: m.partial ? t("chart.daysOf", { n: m.days_elapsed ?? 0, total: m.days_in_month ?? 0 }) : "",
      ...Object.fromEntries(CURRENCY_GROUPS.map((g) => [g, major(m.spent_by_currency[g] ?? 0, currency)])),
    }));
    return {
      data,
      series: CURRENCY_GROUPS.map((g) => ({
        type: "bar" as const,
        xKey: "label",
        yKey: g,
        yName: g === "OTHER" ? t("chart.other") : t("chart.paidIn", { currency: g }),
        stacked: true,
        itemStyler: partialStyle,
        tooltip: {
          renderer: (p: { datum: Record<string, number | string | boolean>; yKey: string }) => ({
            heading: String(p.datum.month),
            title: g === "OTHER" ? t("chart.other") : t("chart.paidIn", { currency: g }),
            data: [
              { label: t("chart.inCurrency", { currency }), value: fmt.full(Number(p.datum[p.yKey])) },
              { label: t("chart.ordersMonth"), value: String(p.datum.orders) },
              ...(p.datum.partial ? [{ label: t("chart.coverage"), value: String(p.datum.coverage) }] : []),
            ],
          }),
        },
      })),
      axes: {
        x: { type: "category", position: "bottom" },
        y: { type: "number", position: "left", label: { formatter: (p: { value: number }) => fmt.compact(p.value) } },
      },
    } as AgChartOptions;
  }, [months, currency, fmt, t, uiLocale]);
  return (
    <>
      <AgChart options={options} height={300} label={title} />
      <DataTable caption={title} head={[t("chart.month"), t("chart.spent"), t("chart.orders")]} rows={months.map((m) => [m.partial ? `${formatMonthYear(m.month, uiLocale)} ${t("chart.toDateSuffix")}` : formatMonthYear(m.month, uiLocale), m.spent.display, m.orders])} />
    </>
  );
}

// --- Treasury: what came in, and the 30-day estimate ------------------------------------------

type Forecast = {
  currency: string;
  forecast_net_earnings: MoneyLike;
  last_28_days_net: MoneyLike;
  previous_28_days_net: MoneyLike;
  trend_percent: number | null;
  sales_in_last_56_days: number;
  low_confidence: boolean;
};

/**
 * Previous 28 days, last 28 days and the forecast, for one currency at a time
 * (currencies cannot share an axis). The forecast is drawn pale and dashed and
 * called an estimate: the model has one average and one trend, no variance, so
 * there is deliberately no confidence band.
 */
export function ForecastChart({ forecasts, locale, title }: { forecasts: Forecast[]; locale: string; title: string }) {
  const { t } = useI18n();
  const ordered = useMemo(() => [...forecasts].sort((a, b) => b.sales_in_last_56_days - a.sales_in_last_56_days || a.currency.localeCompare(b.currency)), [forecasts]);
  const [picked, setPicked] = useState<string | null>(null);
  const current = ordered.find((f) => f.currency === picked) ?? ordered[0];
  const options = useMemo<AgChartOptions | null>(() => {
    if (!current) return null;
    const fmt = moneyFormatter(current.currency, locale);
    const data = [
      { label: t("fc.previous"), amount: major(current.previous_28_days_net, current.currency), display: current.previous_28_days_net.display, estimate: false },
      { label: t("fc.last"), amount: major(current.last_28_days_net, current.currency), display: current.last_28_days_net.display, estimate: false },
      { label: t("fc.next"), amount: major(current.forecast_net_earnings, current.currency), display: current.forecast_net_earnings.display, estimate: true },
    ];
    return {
      data,
      legend: { enabled: false },
      series: [
        {
          type: "bar" as const,
          xKey: "label",
          yKey: "amount",
          yName: t("fc.netEarnings"),
          itemStyler: (p: { datum: Record<string, unknown>; fill?: string }) =>
            p.datum.estimate ? { fillOpacity: 0.5, stroke: p.fill, strokeWidth: 1.5, lineDash: [5, 3] } : undefined,
          label: { enabled: true, placement: "outside-end", formatter: (p: { value: number }) => fmt.compact(p.value), fontSize: 12 },
          tooltip: {
            renderer: (p: { datum: Record<string, number | string | boolean> }) => ({
              heading: String(p.datum.label),
              data: [
                { label: t("fc.netEarnings"), value: String(p.datum.display) },
                ...(p.datum.estimate ? [{ label: t("fc.kind"), value: t("fc.estimate") }] : []),
              ],
            }),
          },
        },
      ],
      axes: {
        x: { type: "category", position: "bottom" },
        y: { type: "number", position: "left", label: { formatter: (p: { value: number }) => fmt.compact(p.value) } },
      },
    } as AgChartOptions;
  }, [current, locale, t]);
  if (!current || !options) return <p className="text-sm text-ink-3">{t("fc.none")}</p>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[56ch] text-sm text-ink-3">
          {t("fc.summary", { next: current.forecast_net_earnings.display, last: current.last_28_days_net.display })}
          {current.trend_percent !== null ? ` ${t("fc.trend", { pct: `${current.trend_percent > 0 ? "+" : ""}${current.trend_percent}%` })}` : ""}
        </p>
        {ordered.length > 1 && (
          <label className="inline-flex items-center gap-2 text-sm text-ink-3">
            {t("fc.currency")}
            <select value={current.currency} onChange={(e) => setPicked(e.target.value)} className="min-h-10 rounded-md border border-rule-strong bg-sheet px-3 text-ink">
              {ordered.map((f) => (
                <option key={f.currency} value={f.currency}>
                  {f.currency}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {current.low_confidence && (
        <p role="note" className="mb-2 rounded-md bg-gold-soft px-3 py-2 text-sm text-gold-ink">
          {t("fc.lowConfidence", { n: current.sales_in_last_56_days })}
        </p>
      )}
      <AgChart options={options} height={260} label={title} />
      <DataTable
        caption={title}
        head={[t("fc.period"), t("fc.netEarnings")]}
        rows={[
          [t("fc.previous"), current.previous_28_days_net.display],
          [t("fc.last"), current.last_28_days_net.display],
          [`${t("fc.next")} (${t("fc.estimate")})`, current.forecast_net_earnings.display],
        ]}
      />
    </>
  );
}

// --- Operations: refunds and failed payments by week ------------------------------------------

type TrendWeek = { week_start: string; orders: number; refunded_orders: number; refund_rate_bps: number | null; declined: number };

/** Two small charts, because a rate (%) and a count do not belong on one axis. */
export function OpsTrendChart({ weeks, title }: { weeks: TrendWeek[]; title: string }) {
  const { t, locale } = useI18n();
  const mode = useTheme();
  const rateOptions = useMemo<AgChartOptions>(() => {
    const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const token = (name: string) => css?.getPropertyValue(name).trim() ?? "";
    const data = weeks.map((w) => ({ label: formatDay(w.week_start, locale), rate: w.refund_rate_bps === null ? null : w.refund_rate_bps / 100, refunded: w.refunded_orders, orders: w.orders }));
    return {
      data,
      legend: { enabled: false },
      series: [
        {
          type: "line" as const,
          xKey: "label",
          yKey: "rate",
          yName: t("ops.trend.refundRate"),
          stroke: token("--series-5"),
          strokeWidth: 2.5,
          marker: { enabled: true, size: 7, fill: token("--series-5"), stroke: token("--sheet"), strokeWidth: 1.5 },
          tooltip: {
            renderer: (p: { datum: Record<string, number | string | null> }) => ({
              heading: t("ops.trend.weekOf", { date: String(p.datum.label) }),
              data: [
                { label: t("ops.trend.refundRate"), value: p.datum.rate === null ? "-" : `${Number(p.datum.rate).toFixed(1)}%` },
                { label: t("chart.refundedOrders"), value: t("chart.refundedOf", { n: Number(p.datum.refunded), total: Number(p.datum.orders) }) },
              ],
            }),
          },
        },
      ],
      axes: {
        x: { type: "category", position: "bottom", label: { fontSize: 11 } },
        y: { type: "number", position: "left", min: 0, label: { formatter: (p: { value: number }) => `${p.value}%` } },
      },
    } as AgChartOptions;
    // `mode` is a dependency so token colours are re-read after a theme switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, locale, t, mode]);
  const declinedOptions = useMemo<AgChartOptions>(() => {
    const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const token = (name: string) => css?.getPropertyValue(name).trim() ?? "";
    const data = weeks.map((w) => ({ label: formatDay(w.week_start, locale), declined: w.declined }));
    return {
      data,
      legend: { enabled: false },
      series: [
        {
          type: "bar" as const,
          xKey: "label",
          yKey: "declined",
          yName: t("ops.trend.declined"),
          fill: token("--alert"),
          tooltip: {
            renderer: (p: { datum: Record<string, number | string> }) => ({
              heading: t("ops.trend.weekOf", { date: String(p.datum.label) }),
              data: [{ label: t("ops.trend.declined"), value: String(p.datum.declined) }],
            }),
          },
        },
      ],
      axes: {
        x: { type: "category", position: "bottom", label: { fontSize: 11 } },
        y: { type: "number", position: "left", min: 0, label: { formatter: (p: { value: number }) => String(Math.round(p.value)) }, interval: { minSpacing: 40 } },
      },
    } as AgChartOptions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, locale, t, mode]);

  const latest = weeks[weeks.length - 1];
  return (
    <>
      {latest && (
        <p className="mb-3 max-w-[64ch] text-sm text-ink-3">
          {t("ops.trend.latest", { rate: latest.refund_rate_bps === null ? "-" : formatBps(latest.refund_rate_bps), n: latest.declined })}
        </p>
      )}
      <div className="grid gap-6 cq-md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-ink">{t("ops.trend.refundRate")}</h3>
          <AgChart options={rateOptions} height={200} label={`${title}: ${t("ops.trend.refundRate")}`} />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-ink">{t("ops.trend.declined")}</h3>
          <AgChart options={declinedOptions} height={200} label={`${title}: ${t("ops.trend.declined")}`} />
        </div>
      </div>
      <DataTable
        caption={title}
        head={[t("ops.trend.week"), t("ops.trend.paidOrders"), t("chart.refundedOrders"), t("ops.trend.refundRate"), t("ops.trend.declined")]}
        rows={weeks.map((w) => [formatDay(w.week_start, locale), w.orders, w.refunded_orders, w.refund_rate_bps === null ? "-" : formatBps(w.refund_rate_bps), w.declined])}
      />
    </>
  );
}
