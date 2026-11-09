"use client";

import type { ColDef } from "ag-grid-community";
import { useEffect, useMemo, useState } from "react";
import { ForecastChart } from "@/components/agcharts/Charts";
import { api, type Money } from "@/components/api";
import { AskAi } from "@/components/AskAi";
import { ChatPanel } from "@/components/ChatPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AutoProposalsToggle } from "@/components/findings/AutoProposalsToggle";
import { FindingsFeed } from "@/components/findings/FindingsFeed";
import { Grid } from "@/components/grid/Grid";
import { countCol, marketCol, moneyCol } from "@/components/grid/columns";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CapGauge, type CapCard } from "@/components/treasury/CapGauge";
import { Panel, SectionHeading } from "@/components/ui";
import type { DashboardPeriod } from "@/lib/periods";

type Overview = {
  cards: CapCard[];
  forecasts: {
    currency: string;
    forecast_net_earnings: Money;
    last_28_days_net: Money;
    previous_28_days_net: Money;
    trend_percent: number | null;
    sales_in_last_56_days: number;
    low_confidence: boolean;
  }[];
  note: string;
};
type EarningsRow = {
  id: string;
  market: string;
  currency: string;
  orders: number;
  gross_sales: Money;
  paypal_fees: Money;
  platform_fees: Money;
  fx_costs: Money;
  net_earnings: Money;
  refund_debits: Money;
  net_after_refunds: Money;
};

const primaryBtn = "bg-accent text-sheet hover:brightness-95";
const secondaryBtn = "border border-rule-strong text-ink-2 hover:bg-sheet-2 hover:text-ink";

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" aria-hidden>
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TreasuryView({ period }: { period: DashboardPeriod }) {
  const { t, locale } = useI18n();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [earnings, setEarnings] = useState<EarningsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [confirming, setConfirming] = useState<CapCard | null>(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api<Overview>("/api/treasury/overview").then(
      (r) => setOverview(r),
      (e) => setError(e instanceof Error ? e.message : t("tre.error")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  useEffect(() => {
    api<{ markets: Omit<EarningsRow, "id">[] }>(`/api/earnings?period=${period}`).then(
      (r) => setEarnings(r.markets.map((m) => ({ ...m, id: `${m.market}|${m.currency}` }))),
      (e) => setError(e instanceof Error ? e.message : t("tre.error")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, tick]);

  async function payOut() {
    const card = confirming;
    if (!card) return;
    setPaying(true);
    setNotice(null);
    try {
      const r = await api<{ status: string; error?: string | null }>("/api/payouts", { body: { currency: card.currency } });
      setNotice(
        r.status === "EXECUTED"
          ? { tone: "ok", text: t("tre.payoutStarted", { currency: card.currency }) }
          : { tone: "error", text: r.error ?? t("tre.payoutFailed") },
      );
      setTick((n) => n + 1);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : t("tre.payoutFailed") });
    } finally {
      setPaying(false);
      setConfirming(null);
    }
  }

  const cols = useMemo<ColDef<EarningsRow>[]>(
    () => [
      marketCol<EarningsRow>("market", t("col.market"), { width: 160, pinned: "left" }),
      countCol<EarningsRow>("orders", t("col.orders")),
      moneyCol<EarningsRow>("gross_sales", t("col.sales")),
      moneyCol<EarningsRow>("paypal_fees", t("col.paypalFees"), { tone: "muted" }),
      moneyCol<EarningsRow>("platform_fees", t("col.platformFees"), { tone: "muted" }),
      moneyCol<EarningsRow>("fx_costs", t("col.conversion"), { tone: "muted" }),
      moneyCol<EarningsRow>("net_earnings", t("col.net")),
      moneyCol<EarningsRow>("refund_debits", t("col.refundCost"), { tone: "fee" }),
      moneyCol<EarningsRow>("net_after_refunds", t("tre.netAfterRefunds"), { tone: "net", width: 150 }),
    ],
    [t],
  );

  const cards = overview?.cards ?? [];
  // One primary action: the currency closest to the cheap payout, if it has anything to pay out.
  const primary = cards[0] && cards[0].available.amount_minor > 0 ? cards[0].currency : null;

  return (
    <div className="flex flex-col gap-6">
      <FindingsFeed agent="TREASURY" />

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md px-4 py-2.5 text-sm ${notice.tone === "ok" ? "bg-positive-soft text-positive-ink" : "bg-alert-soft text-alert-ink"}`}>
          {notice.text}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft px-4 py-2.5 text-sm text-alert-ink">
          {error}
        </p>
      )}

      <section aria-labelledby="balances-title">
        <SectionHeading id="balances-title" title={t("tre.balances")} aside={t("tre.balancesHint")} />
        {overview && cards.length === 0 && <p className="text-sm text-ink-3">{t("tre.noBalances")}</p>}
        {!overview && <div className="h-40 animate-pulse rounded-[10px] border border-rule bg-sheet-2" aria-hidden />}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => {
            const hasMoney = c.available.amount_minor > 0;
            return (
              <article key={c.currency} aria-label={c.currency} className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm text-ink-3">
                      <span className="inline-flex h-[22px] min-w-[38px] items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-ink-3 px-1 text-[11px] font-bold tracking-wide text-ink-2">{c.currency}</span>
                      {t("tre.available")}
                    </p>
                    <p className="num mt-1 font-display text-[1.9rem] leading-none font-semibold tracking-[-0.02em]">{c.available.display}</p>
                  </div>
                  {hasMoney && (
                    <span className={`inline-flex max-w-[55%] items-center gap-1.5 rounded-[3px] px-2 py-1 text-xs font-semibold ${c.cap_reached ? "bg-positive-soft text-positive-ink" : "bg-sheet-2 text-ink-2"}`}>
                      {c.cap_reached && <Check />}
                      {c.cap_reached ? t("tre.capReached", { fee: c.estimated_payout_fee.display }) : t("tre.untilCap", { amount: c.until_cap.display })}
                    </span>
                  )}
                </header>
                <CapGauge card={c} />
                <button
                  type="button"
                  disabled={!hasMoney || paying}
                  aria-label={t("tre.payOutAria", { currency: c.currency })}
                  onClick={() => setConfirming(c)}
                  className={`mt-auto inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${c.currency === primary ? primaryBtn : secondaryBtn}`}
                >
                  {hasMoney ? t("tre.payOut") : t("tre.nothingToPay")}
                </button>
              </article>
            );
          })}
        </div>
        {overview && cards.length > 0 && <p className="mt-2 text-xs text-ink-3">{overview.note}</p>}
      </section>

      <AutoProposalsToggle />

      <Panel labelledBy="forecast-title">
        <SectionHeading id="forecast-title" title={t("tre.forecastTitle")} aside={t("tre.forecastSub")} />
        {overview ? <ForecastChart forecasts={overview.forecasts} locale={locale} title={t("tre.forecastTitle")} /> : <div className="h-[260px] animate-pulse rounded-md bg-sheet-2" aria-hidden />}
      </Panel>

      <section aria-labelledby="earnings-title" className="flex flex-col gap-3">
        <h2 id="earnings-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
          {t("tre.earningsTitle")}
        </h2>
        <Grid<EarningsRow>
          label={t("tre.earningsTitle")}
          storageKey="seller-treasury-earnings-v1"
          rowData={earnings}
          columnDefs={cols}
          getRowId={(r) => r.id}
          exportName={`earnings-${period}`}
          searchHint={t("tre.earningsSearch")}
          emptyMessage={t("tre.earningsEmpty")}
          pageSize={20}
        />
      </section>

      <AskAi label={t("tre.assistant")} hint={t("tre.assistantHint")}>
        <ChatPanel title={t("tre.assistantTitle")} agent="TREASURY" placeholder={t("tre.assistantPlaceholder")} onResult={() => setTick((n) => n + 1)} />
      </AskAi>

      <ConfirmDialog
        open={confirming !== null}
        title={t("tre.confirmTitle", { currency: confirming?.currency ?? "" })}
        confirmLabel={paying ? t("tre.sending") : t("tre.confirm")}
        cancelLabel={t("tre.cancel")}
        busy={paying}
        onConfirm={() => void payOut()}
        onCancel={() => setConfirming(null)}
      >
        {confirming && (
          <>
            <p>{t("tre.confirmBody", { amount: confirming.payout_amount.display, fee: confirming.estimated_payout_fee.display })}</p>
            <p className="text-sm text-ink-3">{t("tre.confirmNote")}</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
