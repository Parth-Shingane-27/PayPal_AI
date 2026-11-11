"use client";

import type { AgChartOptions } from "ag-charts-community";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { Money } from "@/components/api";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatMonthKey, formatMonthYear } from "@/lib/format";

const AgChart = dynamic(() => import("@/components/agcharts/AgChart"), {
  ssr: false,
  loading: () => <div className="h-[280px] w-full animate-pulse rounded-md bg-sheet-2" aria-hidden />,
});

/**
 * Net released to the freelancer per month, in their home currency at
 * reference rates (freelancerOverview.released_by_month). Tooltips and the
 * hidden data table show the server's display strings; only bar heights and
 * axis ticks read the amount as a number (like the other AG Charts).
 */
export function ReleasedByMonthChart({ months, currency, title }: { months: { month: string; net: Money }[]; currency: string; title: string }) {
  const { t, locale } = useI18n();
  const options = useMemo<AgChartOptions>(() => {
    const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
    return {
      data: months.map((m) => ({ label: formatMonthKey(m.month, locale), month: formatMonthYear(m.month, locale), value: m.net.amount_minor / 10 ** (currency === "JPY" ? 0 : 2), display: m.net.display })),
      series: [
        {
          type: "bar",
          xKey: "label",
          yKey: "value",
          yName: t("fl.ov.released"),
          tooltip: {
            renderer: (p: { datum: { month: string; display: string } }) => ({ heading: p.datum.month, data: [{ label: t("fl.ov.released"), value: p.datum.display }] }),
          },
        },
      ],
      axes: {
        x: { type: "category", position: "bottom" },
        y: { type: "number", position: "left", title: { text: t("chart.inCurrency", { currency }) }, label: { formatter: (p: { value: number }) => compact.format(p.value) } },
      },
      legend: { enabled: false },
    } as AgChartOptions;
  }, [months, currency, locale, t]);

  if (months.length === 0) return <p className="text-sm text-ink-3">{t("fl.ov.noReleases")}</p>;
  return (
    <>
      <AgChart options={options} height={280} label={title} />
      <table className="sr-only-table">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{t("chart.month")}</th>
            <th scope="col">{t("fl.ov.released")}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{formatMonthYear(m.month, locale)}</th>
              <td>{m.net.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
