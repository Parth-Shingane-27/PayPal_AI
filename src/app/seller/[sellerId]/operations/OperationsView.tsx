"use client";

import type { ColDef } from "ag-grid-community";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OpsTrendChart } from "@/components/agcharts/Charts";
import { usePageAssistant } from "@/components/assistant/AssistantContext";
import { api, type Money as MoneyT } from "@/components/api";
import { FindingsFeed } from "@/components/findings/FindingsFeed";
import { Grid } from "@/components/grid/Grid";
import { countryCol, dateCol, marketCol, moneyCol, productCol, statusCol, threadCol } from "@/components/grid/columns";
import { IconCheck, IconMessages, IconPulse } from "@/components/icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import { shortId } from "@/lib/format";
import { useBase } from "@/lib/use-base";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/periods";
import type { MessageKey } from "@/lib/i18n/messages";
import { StatusStamp } from "@/components/ui";
import { type DrawerOrder, OrderDrawer } from "../ledger/OrderDrawer";

type Row = DrawerOrder & {
  buyer_country: string;
  units: number;
  refunded: MoneyT;
  refundable: MoneyT;
};

type Summary = {
  status_counts: Record<string, number>;
  refundable_orders: number;
  waiting_threads: { id: string; subject: string; buyer: string }[];
  pending_approvals: number;
  anomalies: { type: string; severity: "low" | "medium" | "high"; summary: string; count: number; order_id: string | null }[];
  trend: { week_start: string; orders: number; refunded_orders: number; refund_rate_bps: number | null; declined: number }[];
};

const STATUSES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "PENDING_PAYMENT"] as const;

function AttentionItem({ tone, icon, title, body, action }: { tone: "alert" | "gold" | "ink"; icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  const toneCls = tone === "alert" ? "bg-alert-soft text-alert-ink" : tone === "gold" ? "bg-gold-soft text-gold-ink" : "bg-sheet-2 text-ink-2";
  return (
    <li className="flex gap-3 py-3">
      <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneCls}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{title}</p>
        {body && <p className="text-sm text-ink-3">{body}</p>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </li>
  );
}

const actionLink = "inline-flex min-h-10 items-center rounded-md border border-rule-strong px-3 text-sm font-medium text-ink hover:border-accent hover:text-accent";

export function OperationsView({ period }: { period: DashboardPeriod }) {
  const { t, locale } = useI18n();
  const base = useBase();
  const [rows, setRows] = useState<{ key: string; data: Row[] } | null>(null);
  const [summary, setSummary] = useState<{ key: string; data: Summary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [onlyRefundable, setOnlyRefundable] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const k = `${period}|${tick}`;
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : t("ops.error"));
    api<{ rows: Row[] }>(`/api/analytics/seller/sales?period=${period}`).then((r) => setRows({ key: k, data: r.rows }), fail);
    api<Summary>(`/api/operations/summary?period=${period}`).then((r) => setSummary({ key: k, data: r }), fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, tick]);

  // Keep showing the previous rows while a refresh loads, so the grid does not flash.
  const data = rows?.data ?? null;
  const s = summary?.data ?? null;

  const filter = useMemo(() => {
    if (!status && !onlyRefundable) return null;
    return (r: Row) => (!status || r.status === status) && (!onlyRefundable || r.refundable.amount_minor > 0);
  }, [status, onlyRefundable]);

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      productCol<Row>("items", "image_url", (r) => `${r.units === 1 ? t("cell.item") : t("cell.items", { n: r.units })}, ${t("cell.orderShort", { id: shortId(r.order_id) })}`, { headerName: t("col.order"), width: 250 }),
      dateCol<Row>("date", t("col.date"), { sort: "desc", locale, width: 124 }),
      statusCol<Row>("status", t, { width: 150 }),
      { field: "buyer", headerName: t("col.buyer"), width: 130 },
      // The figures a seller acts on come first, so they are on screen without scrolling; the rest follow.
      moneyCol<Row>("gross", t("col.paidByBuyer"), { width: 116 }),
      moneyCol<Row>("net", t("col.reachedYou"), { tone: "net", width: 116 }),
      moneyCol<Row>("refundable", t("col.stillRefundable"), { width: 124 }),
      {
        colId: "refund",
        headerName: "",
        width: 104,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Row; node: { rowPinned?: string | null } }) =>
          p.data && !p.node.rowPinned && p.data.refundable.amount_minor > 0 ? (
            <button type="button" className="min-h-8 rounded-md border border-rule-strong px-2.5 text-sm font-medium hover:border-accent hover:text-accent" onClick={() => setOpen(p.data!)}>
              {t("cell.refund")}
            </button>
          ) : null,
      },
      marketCol<Row>("market", t("col.market"), { width: 140 }),
      countryCol<Row>("buyer_country", t("col.shipsTo"), { width: 100 }),
      moneyCol<Row>("refunded", t("col.refunded"), { tone: "fee", width: 116 }),
      threadCol<Row>("conversation_id", (id) => `${base}/messages?c=${id}`, t),
    ],
    [t, locale, base],
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // The assistant panel talks to the Operations agent here; refresh the orders after it replies (it may have proposed a refund).
  usePageAssistant({ agent: "OPERATIONS", onResult: refresh });
  const close = useCallback(() => setOpen(null), []);

  const attentionCount = s ? s.waiting_threads.length + (s.pending_approvals > 0 ? 1 : 0) + s.anomalies.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("ops.title")}</h1>
          <p className="mt-1 text-ink-3">{t("ops.intro")}</p>
        </div>
        <nav aria-label={t("period.label")} className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
          {DASHBOARD_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`${base}/operations?period=${p.key}`}
              scroll={false}
              aria-current={p.key === period ? "true" : undefined}
              className={`inline-flex min-h-10 items-center rounded-[5px] px-3 text-sm ${p.key === period ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2 hover:text-ink"}`}
            >
              {t(`period.${p.key}` as MessageKey)}
            </Link>
          ))}
        </nav>
      </header>

      <FindingsFeed agent="OPERATIONS" />

      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}

      <div className="grid items-start gap-6 cq-lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="attention" className="min-w-0 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="attention" className="font-display text-xl font-semibold">
              {t("ops.attention")}
            </h2>
            {s && <span className="text-sm text-ink-3">{attentionCount === 0 ? t("ops.allClear") : t("ops.items", { n: attentionCount })}</span>}
          </div>
          {!s && <p className="mt-3 text-sm text-ink-3">{t("ops.checking")}</p>}
          {s && attentionCount === 0 && <p className="mt-3 text-sm text-ink-3">{t("ops.nothing")}</p>}
          {s && attentionCount > 0 && (
            <ul className="mt-1 divide-y divide-rule">
              {s.waiting_threads.length > 0 && (
                <AttentionItem
                  tone="alert"
                  icon={<IconMessages />}
                  title={s.waiting_threads.length === 1 ? t("ops.waitingOne") : t("ops.waiting", { n: s.waiting_threads.length })}
                  body={s.waiting_threads
                    .slice(0, 3)
                    .map((t) => `${t.buyer}: ${t.subject.toLowerCase()}`)
                    .join("; ")}
                  action={
                    <Link href={`${base}/messages`} className={actionLink}>
                      {t("ops.reply")}
                    </Link>
                  }
                />
              )}
              {s.pending_approvals > 0 && (
                <AttentionItem
                  tone="gold"
                  icon={<IconCheck />}
                  title={s.pending_approvals === 1 ? t("ops.approvalsOne") : t("ops.approvals", { n: s.pending_approvals })}
                  body={t("ops.approvalsBody")}
                  action={
                    <Link href={`${base}/approvals`} className={actionLink}>
                      {t("ops.review")}
                    </Link>
                  }
                />
              )}
              {s.anomalies.map((a, i) => (
                <AttentionItem
                  key={`${a.type}-${i}`}
                  tone={a.severity === "high" ? "alert" : a.severity === "medium" ? "gold" : "ink"}
                  icon={<IconPulse />}
                  title={a.summary}
                  body={t(`sev.${a.severity}` as MessageKey)}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="by-status" className="min-w-0 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
          <h2 id="by-status" className="font-display text-xl font-semibold">
            {t("ops.byStatus")}
          </h2>
          <p className="text-sm text-ink-3">{t("ops.byStatusHint")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t("ops.filterStatus")}>
            {STATUSES.map((st) => {
              const active = status === st;
              return (
                <button
                  key={st}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatus(active ? null : st)}
                  className={`flex min-h-16 flex-col items-start justify-between rounded-md border p-3 text-left ${active ? "border-accent bg-accent-soft" : "border-rule hover:border-rule-strong hover:bg-sheet-2"}`}
                >
                  <StatusStamp status={st} label={t(`status.${st}` as MessageKey)} />
                  <span className="num font-display text-2xl font-semibold">{s ? (s.status_counts[st] ?? 0) : "–"}</span>
                </button>
              );
            })}
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={onlyRefundable} onChange={(e) => setOnlyRefundable(e.target.checked)} />
            {t("ops.onlyRefundable")}{s ? ` (${s.refundable_orders})` : ""}
          </label>
        </section>
      </div>

      {s && s.trend.length > 0 && (
        <section aria-labelledby="trend-title" className="min-w-0 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
          <h2 id="trend-title" className="font-display text-xl font-semibold">
            {t("ops.trend.title")}
          </h2>
          <p className="mb-3 text-sm text-ink-3">{t("ops.trend.sub")}</p>
          <OpsTrendChart weeks={s.trend} title={t("ops.trend.title")} />
        </section>
      )}

      <section aria-labelledby="orders-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="orders-title" className="font-display text-xl font-semibold">
            {t("ops.orders")}
          </h2>
          {(status || onlyRefundable) && (
            <button
              type="button"
              className="min-h-10 text-sm font-medium text-accent hover:underline"
              onClick={() => {
                setStatus(null);
                setOnlyRefundable(false);
              }}
            >
              {t("ops.clear")}
            </button>
          )}
        </div>
        <Grid<Row>
          label={t("ops.orders")}
          storageKey="seller-operations-v1"
          rowData={data}
          columnDefs={cols}
          getRowId={(r) => r.order_id}
          onRowClicked={(r) => setOpen(r)}
          externalFilter={filter}
          exportName={`orders-${period}`}
          searchHint={t("ledger.search.sales")}
          emptyMessage={t("ledger.empty.sales")}
          rowHeight={52}
        />
      </section>

      <OrderDrawer row={open} onClose={close} onChanged={refresh} />
    </div>
  );
}
