"use client";

import type { AgChartOptions } from "ag-charts-community";
import type { MessageKey } from "@/lib/i18n/messages";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../shell/ThemeToggle";
import { formatMonthKey, formatMonthYear, type MoneyLike } from "@/lib/format";

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

type SellerMonth = { month: string; orders: number; net: MoneyLike; paypal_fees: MoneyLike; platform_fees: MoneyLike; fx_costs: MoneyLike; refunds: MoneyLike };

export function SellerMonthlyChart({ months, currency, locale, title }: { months: SellerMonth[]; currency: string; locale: string; title: string }) {
  const { t, locale: uiLocale } = useI18n();
  const fmt = useMemo(() => moneyFormatter(currency, locale), [currency, locale]);
  const keys = [
    { key: "net", name: t("chart.reachedYou") },
    { key: "paypal_fees", name: t("chart.paypal") },
    { key: "platform_fees", name: t("chart.platform") },
    { key: "fx_costs", name: t("chart.conversion") },
    { key: "refunds", name: t("chart.refunds") },
  ] as const;
  const options = useMemo<AgChartOptions>(() => {
    const data = months.map((m) => ({
      label: formatMonthKey(m.month, uiLocale),
      month: formatMonthYear(m.month, uiLocale),
      orders: m.orders,
      ...Object.fromEntries(keys.map((k) => [k.key, Math.max(0, major(m[k.key], currency))])),
    }));
    return {
      data,
      series: keys.map((k) => ({
        type: "bar" as const,
        xKey: "label",
        yKey: k.key,
        yName: k.name,
        stacked: true,
        tooltip: {
          renderer: (p: { datum: Record<string, number | string>; yKey: string }) => ({
            heading: String(p.datum.month),
            title: k.name,
            data: [
              { label: t("chart.amount"), value: fmt.full(Number(p.datum[p.yKey])) },
              { label: t("chart.ordersMonth"), value: String(p.datum.orders) },
            ],
          }),
        },
      })),
      axes: {
        x: { type: "category", position: "bottom" },
        y: { type: "number", position: "left", label: { formatter: (p: { value: number }) => fmt.compact(p.value) } },
      },
    } as AgChartOptions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, currency, fmt, t, uiLocale]);
  return (
    <>
      <AgChart options={options} height={320} label={title} />
      <DataTable
        caption={title}
        head={[t("chart.month"), ...keys.map((k) => k.name)]}
        rows={months.map((m) => [formatMonthYear(m.month, uiLocale), ...keys.map((k) => m[k.key].display)])}
      />
    </>
  );
}

// --- Seller: markets, coloured by region ---------------------------------------------------

const REGIONS = ["Americas", "Europe", "Asia-Pacific"] as const;
/** Region colours are chart slots 1-3 (blue, orange, violet), validated as a set. */
const REGION_SLOT: Record<(typeof REGIONS)[number], string> = { Americas: "--series-1", Europe: "--series-2", "Asia-Pacific": "--series-3" };

type MarketRow = { market: string; country: string; region: string; orders: number; net: MoneyLike; share_bps: number };

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
      share: m.share_bps / 100,
      ...Object.fromEntries(REGIONS.map((r) => [r, m.region === r ? major(m.net, currency) : 0])),
    }));
    return {
      data,
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

type BuyerMonth = { month: string; orders: number; spent: MoneyLike; spent_by_currency: Record<string, number> };

export function BuyerSpendChart({ months, currency, locale, title }: { months: BuyerMonth[]; currency: string; locale: string; title: string }) {
  const { t, locale: uiLocale } = useI18n();
  const fmt = useMemo(() => moneyFormatter(currency, locale), [currency, locale]);
  const options = useMemo<AgChartOptions>(() => {
    const data = months.map((m) => ({
      label: formatMonthKey(m.month, uiLocale),
      month: formatMonthYear(m.month, uiLocale),
      orders: m.orders,
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
        tooltip: {
          renderer: (p: { datum: Record<string, number | string>; yKey: string }) => ({
            heading: String(p.datum.month),
            title: g === "OTHER" ? t("chart.other") : t("chart.paidIn", { currency: g }),
            data: [
              { label: t("chart.inCurrency", { currency }), value: fmt.full(Number(p.datum[p.yKey])) },
              { label: t("chart.ordersMonth"), value: String(p.datum.orders) },
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
      <DataTable caption={title} head={[t("chart.month"), t("chart.spent"), t("chart.orders")]} rows={months.map((m) => [formatMonthYear(m.month, uiLocale), m.spent.display, m.orders])} />
    </>
  );
}
