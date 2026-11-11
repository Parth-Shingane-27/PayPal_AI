"use client";

import type { ColDef } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Money as MoneyT } from "@/components/api";
import { Grid } from "@/components/grid/Grid";
import { countCol, dateCol, marketCol, moneyCol } from "@/components/grid/columns";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CountryStamp, MarketStamp } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/messages";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/periods";
import { MilestoneStamp, milestoneStateLabel } from "./MilestoneStamp";
import { useGigBase } from "./use-gig-base";

export type GigLedgerTab = "milestones" | "clients" | "services" | "markets";
export const GIG_LEDGER_TABS: GigLedgerTab[] = ["milestones", "clients", "services", "markets"];

/** Reads ?tab= from a page's searchParams; anything unknown is "milestones". */
export function parseGigLedgerTab(v: string | string[] | undefined): GigLedgerTab {
  const s = Array.isArray(v) ? v[0] : v;
  return GIG_LEDGER_TABS.includes(s as GigLedgerTab) ? (s as GigLedgerTab) : "milestones";
}

/** One milestone (milestoneRows in server/services/gig/dashboards.ts). */
type MilestoneRow = {
  milestone_id: string;
  contract_id: string;
  contract: string;
  milestone: string;
  service: string | null;
  client: string;
  client_country: string;
  market: string;
  currency: string;
  state: string;
  amount: MoneyT;
  in_holding: MoneyT;
  paypal_fee: MoneyT;
  platform_fee: MoneyT;
  fx_cost: MoneyT;
  fees: MoneyT;
  fees_are_estimates: boolean;
  net: MoneyT | null;
  refunded: MoneyT;
  due_date: string | null;
  funded_at: string | null;
  released_at: string | null;
  invoice: { invoice_id: string; number: string } | null;
};

/** One client, service or market in one currency (aggregate in dashboards.ts). */
type AggRow = {
  key: string;
  currency: string;
  milestones: number;
  funded: MoneyT;
  in_holding: MoneyT;
  released_net: MoneyT;
  refunded: MoneyT;
};

/** Per-currency totals of the period's milestones (totalsOf in dashboards.ts), summed on the server. */
type TotalRow = { currency: string; milestones: number; amount: MoneyT; in_holding: MoneyT; fees: MoneyT; net: MoneyT; refunded: MoneyT };

type LedgerData = { period: { label: string }; totals?: TotalRow[]; milestones: MilestoneRow[]; clients: AggRow[]; services: AggRow[]; markets: AggRow[] };

/** The server's label for milestones that came from a custom quote rather than a listed service. */
const CUSTOM_QUOTE = "Custom quote";

type Pinned = { node: { rowPinned?: string | null } };

/**
 * Freelancer earnings ledger on AG Grid: Milestones, Clients, Services and
 * Markets tabs from GET /api/freelancer/ledger?period=<preset> (one request per
 * period; switching tab does not refetch). Every tab shows "In holding" next to
 * the released net. Tabs and periods are links to the current path with
 * ?tab=&period=, so the page reads both from searchParams and passes them in:
 *
 *   <GigLedgerGrid period={parseDashboardPeriod(sp.period)} tab={parseGigLedgerTab(sp.tab)} />
 *
 * Quick filter, column chooser, CSV export and saved layout come from the shared
 * Grid. Money is never summed here: on the Milestones tab the period's totals
 * come from the API (`totals`, one row per currency). With one currency they
 * fill the pinned footer row; with several, the footer counts rows and the
 * per-currency totals sit in a table right under the grid (the shared Grid
 * pins a single footer row). Other tabs' footers count rows.
 */
export function GigLedgerGrid({
  period,
  tab,
  title,
  headingLevel = 1,
}: {
  period: DashboardPeriod;
  tab: GigLedgerTab;
  /** Page heading; defaults to "Earnings ledger". */
  title?: string;
  /** 2 when the grid sits under another page heading (e.g. the Earnings page). */
  headingLevel?: 1 | 2;
}) {
  const { t, locale } = useI18n();
  const base = useGigBase();
  const pathname = usePathname();
  const [loaded, setLoaded] = useState<{ period: DashboardPeriod; data?: LedgerData; error?: string } | null>(null);
  const current = loaded?.period === period ? loaded : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    let alive = true;
    api<LedgerData>(`/api/freelancer/ledger?period=${period}`).then(
      (r) => alive && setLoaded({ period, data: r }),
      (e: unknown) => alive && setLoaded({ period, error: e instanceof Error ? e.message : t("ledger.error") }),
    );
    return () => {
      alive = false;
    };
  }, [period, t]);

  const pinnedLabel = useCallback((p: Pinned & { value?: unknown }) => (p.node.rowPinned ? <span className="font-semibold">{String(p.value ?? "")}</span> : null), []);

  const milestoneCols = useMemo<ColDef<MilestoneRow>[]>(
    () => [
      {
        field: "contract",
        headerName: t("shared.led.col.contract"),
        pinned: "left",
        lockPinned: true,
        lockVisible: true,
        width: typeof window !== "undefined" && window.innerWidth < 640 ? 180 : 260,
        minWidth: 160,
        getQuickFilterText: (p) => `${p.data?.contract ?? ""} ${p.data?.service ?? ""}`,
        cellRenderer: (p: CustomCellRendererProps<MilestoneRow, string>) =>
          p.node.rowPinned ? (
            pinnedLabel(p)
          ) : p.data ? (
            <span className="flex h-full min-w-0 flex-col justify-center leading-tight">
              <Link href={`${base}/projects/${p.data.contract_id}`} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                {p.data.contract}
              </Link>
              <span className="block truncate text-xs text-ink-3">{p.data.service ?? t("shared.led.customQuote")}</span>
            </span>
          ) : null,
      },
      { field: "milestone", headerName: t("shared.led.col.milestone"), width: 220 },
      {
        field: "client",
        headerName: t("shared.led.col.client"),
        width: 210,
        getQuickFilterText: (p) => `${p.data?.client ?? ""} ${p.data?.client_country ?? ""}`,
        cellRenderer: (p: CustomCellRendererProps<MilestoneRow, string>) =>
          p.data && !p.node.rowPinned ? (
            <span className="flex h-full min-w-0 items-center gap-2">
              <span className="truncate">{p.data.client}</span>
              <CountryStamp country={p.data.client_country} />
            </span>
          ) : null,
      },
      marketCol<MilestoneRow>("market", t("col.market")),
      {
        field: "state",
        headerName: t("col.status"),
        width: 210,
        valueFormatter: (p) => (p.value ? milestoneStateLabel(t, p.value as string) : ""),
        getQuickFilterText: (p) => (p.value ? milestoneStateLabel(t, p.value as string) : ""),
        cellRenderer: (p: CustomCellRendererProps<MilestoneRow, string>) => (p.value && !p.node.rowPinned ? <MilestoneStamp state={p.value} /> : null),
      },
      moneyCol<MilestoneRow>("amount", t("shared.led.col.amount")),
      moneyCol<MilestoneRow>("fees", t("shared.led.col.fees"), { tone: "fee", estimateField: "fees_are_estimates", width: 150 }),
      moneyCol<MilestoneRow>("in_holding", t("shared.led.col.inHolding"), { width: 140 }),
      moneyCol<MilestoneRow>("net", t("shared.led.col.netReleased"), { tone: "net", width: 150 }),
      moneyCol<MilestoneRow>("refunded", t("col.refunded"), { tone: "fee" }),
      dateCol<MilestoneRow>("due_date", t("shared.led.col.due"), { locale }),
      dateCol<MilestoneRow>("released_at", t("shared.led.col.released"), { locale, sort: "desc" }),
      {
        colId: "invoice",
        headerName: t("shared.led.col.invoice"),
        width: 170,
        valueGetter: (p) => p.data?.invoice?.number ?? null,
        cellRenderer: (p: CustomCellRendererProps<MilestoneRow, string | null>) =>
          p.data?.invoice && !p.node.rowPinned ? (
            <Link href={`${base}/invoices/${p.data.invoice.invoice_id}`} className="num text-accent hover:underline">
              {p.data.invoice.number}
            </Link>
          ) : null,
      },
    ],
    [t, locale, base, pinnedLabel],
  );

  const aggCols = useCallback(
    (kind: Exclude<GigLedgerTab, "milestones">): ColDef<AggRow>[] => [
      kind === "markets"
        ? {
            ...marketCol<AggRow>("key", t("col.market"), { pinned: "left", lockPinned: true, lockVisible: true, width: 190 }),
            cellRenderer: (p: CustomCellRendererProps<AggRow, string>) => (p.node.rowPinned ? pinnedLabel(p) : p.value ? <MarketStamp locale={p.value} /> : null),
          }
        : {
            field: "key",
            headerName: kind === "clients" ? t("shared.led.col.client") : t("shared.led.col.service"),
            pinned: "left",
            lockPinned: true,
            lockVisible: true,
            width: 240,
            cellClass: "font-medium",
            valueFormatter: (p) => (kind === "services" && p.value === CUSTOM_QUOTE ? t("shared.led.customQuote") : String(p.value ?? "")),
            cellRenderer: (p: CustomCellRendererProps<AggRow, string>) =>
              p.node.rowPinned ? pinnedLabel(p) : <span className="truncate">{kind === "services" && p.value === CUSTOM_QUOTE ? t("shared.led.customQuote") : p.value}</span>,
          },
      { field: "currency", headerName: t("col.currency"), width: 110 },
      countCol<AggRow>("milestones", t("shared.led.col.milestones"), { sort: "desc", width: 120 }),
      moneyCol<AggRow>("funded", t("shared.led.col.funded"), { width: 140 }),
      moneyCol<AggRow>("in_holding", t("shared.led.col.inHolding"), { width: 140 }),
      moneyCol<AggRow>("released_net", t("shared.led.col.netReleased"), { tone: "net", width: 150 }),
      moneyCol<AggRow>("refunded", t("col.refunded"), { tone: "fee" }),
    ],
    [t, pinnedLabel],
  );

  const periodTotals = data?.totals ?? [];
  const single = periodTotals.length === 1 ? periodTotals[0]! : null;
  const milestoneTotals = useCallback(
    (rows: MilestoneRow[]): Partial<MilestoneRow> | null => {
      if (!rows.length) return null;
      const label = t("grid.total", { n: rows.length, what: t("shared.led.what.milestones") });
      // One currency: the period's server-side totals fill the footer; the label says they cover the whole period.
      if (single)
        return {
          milestone_id: "__total",
          contract: `${label} · ${t("fl.led.periodTotal", { currency: single.currency })}`,
          amount: single.amount,
          in_holding: single.in_holding,
          fees: single.fees,
          net: single.net,
          refunded: single.refunded,
        };
      return { milestone_id: "__total", contract: label };
    },
    [t, single],
  );
  const aggTotals = useCallback(
    (rows: AggRow[]): Partial<AggRow> | null =>
      rows.length ? { key: t("grid.total", { n: rows.length, what: t("shared.led.what.rows") }), currency: "", milestones: rows.reduce((s, r) => s + r.milestones, 0) } : null,
    [t],
  );

  const periodLabel = t(`period.${period}` as MessageKey);
  const tabLabel = (tb: GigLedgerTab) => t(`shared.led.tab.${tb}` as MessageKey);
  const href = (tb: GigLedgerTab, p: DashboardPeriod) => `${pathname}?tab=${tb}&period=${p}`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          {headingLevel === 1 ? (
            <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{title ?? t("shared.led.title")}</h1>
          ) : (
            <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">{title ?? t("shared.led.title")}</h2>
          )}
          <p className="mt-1 text-ink-3">{t(`shared.led.intro.${tab}` as MessageKey)}</p>
        </div>
        <nav aria-label={t("period.label")} className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
          {DASHBOARD_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={href(tab, p.key)}
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
        {GIG_LEDGER_TABS.map((tb) => (
          <Link
            key={tb}
            href={href(tb, period)}
            scroll={false}
            aria-current={tb === tab ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-4 text-[0.95rem] ${tb === tab ? "border-accent font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            {tabLabel(tb)}
          </Link>
        ))}
      </nav>

      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}

      {tab === "milestones" ? (
        <>
          <Grid<MilestoneRow>
            label={`${tabLabel("milestones")}, ${periodLabel}`}
            storageKey="gig-ledger-milestones-v1"
            rowData={error ? [] : (data?.milestones ?? null)}
            columnDefs={milestoneCols}
            getRowId={(r) => r.milestone_id}
            totals={milestoneTotals}
            exportName={`milestones-${period}`}
            searchHint={t("shared.led.search.milestones")}
            emptyMessage={t("shared.led.empty")}
            rowHeight={52}
          />
          {periodTotals.length > 1 && (
            <div className="overflow-x-auto rounded-[10px] border border-rule bg-sheet">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="px-4 pt-3 text-left font-semibold">{t("fl.led.totalsCaption", { period: periodLabel })}</caption>
                <thead>
                  <tr className="border-b border-rule text-xs text-ink-3">
                    <th scope="col" className="px-4 py-2 text-left font-medium">{t("col.currency")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("shared.led.col.milestones")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("shared.led.col.amount")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("shared.led.col.fees")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("shared.led.col.inHolding")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("shared.led.col.netReleased")}</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">{t("col.refunded")}</th>
                  </tr>
                </thead>
                <tbody>
                  {periodTotals.map((r) => (
                    <tr key={r.currency} className="border-b border-rule bg-sheet-2/60 font-semibold last:border-0">
                      <th scope="row" className="px-4 py-2 text-left">{r.currency}</th>
                      <td className="num px-3 py-2 text-right">{r.milestones}</td>
                      <td className="num px-3 py-2 text-right">{r.amount.display}</td>
                      <td className="num px-3 py-2 text-right text-ink-2">{r.fees.display}</td>
                      <td className="num px-3 py-2 text-right">{r.in_holding.display}</td>
                      <td className="num px-3 py-2 text-right">{r.net.display}</td>
                      <td className="num px-4 py-2 text-right text-ink-2">{r.refunded.display}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <Grid<AggRow>
          key={tab}
          label={`${tabLabel(tab)}, ${periodLabel}`}
          storageKey={`gig-ledger-${tab}-v1`}
          rowData={error ? [] : (data?.[tab] ?? null)}
          columnDefs={aggCols(tab)}
          getRowId={(r) => `${r.key}|${r.currency}`}
          totals={aggTotals}
          exportName={`${tab}-${period}`}
          searchHint={t(`shared.led.search.${tab}` as MessageKey)}
          emptyMessage={t("shared.led.empty")}
        />
      )}

      <p className="text-xs text-ink-3">{t("shared.led.note")}</p>
    </div>
  );
}

