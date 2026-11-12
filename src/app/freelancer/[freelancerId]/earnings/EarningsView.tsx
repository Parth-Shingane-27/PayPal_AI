"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";
import { usePageAssistant } from "@/components/assistant/AssistantContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GigLedgerGrid, parseGigLedgerTab } from "@/components/gig/GigLedgerGrid";
import { AutoPayoutToggle } from "@/components/gig/freelancer/AutoPayoutToggle";
import { errText, Notice, primaryBtn, secondaryBtn } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SectionHeading } from "@/components/ui";
import type { DashboardPeriod } from "@/lib/periods";
import { useBase } from "@/lib/use-base";

type Balance = { currency: string; available: Money; in_holding: Money; released: Money; refunded: Money; paid_out: Money; reserved_for_scheduled_payouts: Money };
type Decision = { status: string; error?: string | null; already_decided: boolean };

export function EarningsView({ period, tab, autoProposals }: { period: DashboardPeriod; /** Raw ?tab= (parsed here: the parser lives in a client module). */ tab: string | undefined; autoProposals: boolean }) {
  const { t } = useI18n();
  const base = useBase();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<Balance | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(
    () =>
      api<{ balances: Balance[] }>("/api/freelancer/balances").then(
        (r) => {
          setBalances(r.balances);
          setError(null);
        },
        (e: unknown) => setError(errText(e, t("fl.error"))),
      ),
    [t],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // The panel talks to the Freelancer Agent here; reload after it replies (it may have drafted a payout for approval).
  usePageAssistant({ agent: "PROFILE", onResult: () => void load() });

  async function payOut() {
    const b = confirming;
    if (!b) return;
    setPaying(true);
    setNotice(null);
    try {
      const r = await api<Decision>("/api/freelancer/payouts", { body: { currency: b.currency } });
      setNotice(r.status === "EXECUTED" ? { tone: "ok", text: t("fl.earn.payoutStarted", { currency: b.currency }) } : { tone: "error", text: r.error ?? t("tre.payoutFailed") });
    } catch (e) {
      setNotice({ tone: "error", text: errText(e, t("tre.payoutFailed")) });
    } finally {
      setPaying(false);
      setConfirming(null);
      void load();
    }
  }

  // Most available first: that is where a payout makes sense.
  const sorted = [...(balances ?? [])].sort((a, b) => Number(b.available.amount_minor > 0) - Number(a.available.amount_minor > 0) || a.currency.localeCompare(b.currency));
  const primary = sorted[0] && sorted[0].available.amount_minor > 0 ? sorted[0].currency : null;

  return (
    <div className="flex flex-col gap-6">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <section aria-labelledby="balances-title">
        <SectionHeading id="balances-title" title={t("tre.balances")} aside={<Link href={`${base}/approvals`} className="text-accent hover:underline">{t("nav.approvals")}</Link>} />
        <div className="mb-4 grid gap-3 rounded-[10px] border border-dashed border-rule-strong bg-sheet-2 p-4 text-sm text-ink-2 cq-md:grid-cols-2">
          <p>
            <strong className="text-ink">{t("fl.ov.available")}.</strong> {t("fl.earn.availableExplain")}
          </p>
          <p>
            <strong className="text-ink">{t("fl.ov.inHolding")}.</strong> {t("fl.earn.holdingExplain")}
          </p>
        </div>
        {balances && balances.length === 0 && <p className="text-sm text-ink-3">{t("fl.earn.none")}</p>}
        {!balances && !error && <div className="h-40 animate-pulse rounded-[10px] border border-rule bg-sheet-2" aria-hidden />}
        <div className="grid gap-4 cq-md:grid-cols-2 cq-xl:grid-cols-3">
          {sorted.map((b) => {
            const hasMoney = b.available.amount_minor > 0;
            return (
              <article key={b.currency} aria-label={b.currency} className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
                <header>
                  <p className="flex items-center gap-2 text-sm text-ink-3">
                    <span className="inline-flex h-[22px] min-w-[38px] items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-ink-3 px-1 text-[11px] font-bold tracking-wide text-ink-2">{b.currency}</span>
                    {t("fl.ov.available")}
                  </p>
                  <p className="num mt-1 font-display text-[1.9rem] leading-none font-semibold tracking-[-0.02em]">{b.available.display}</p>
                </header>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-rule pt-3 text-sm">
                  <dt className="text-ink-3">{t("fl.ov.inHolding")}</dt>
                  <dd className="num text-right font-semibold">{b.in_holding.display}</dd>
                  <dt className="text-ink-3">{t("fl.earn.released")}</dt>
                  <dd className="num text-right">{b.released.display}</dd>
                  <dt className="text-ink-3">{t("tre.refunded")}</dt>
                  <dd className="num text-right">{b.refunded.display}</dd>
                  <dt className="text-ink-3">{t("tre.paidOut")}</dt>
                  <dd className="num text-right">{b.paid_out.display}</dd>
                  <dt className="text-ink-3">{t("tre.reserved")}</dt>
                  <dd className="num text-right">{b.reserved_for_scheduled_payouts.display}</dd>
                </dl>
                <button
                  type="button"
                  disabled={!hasMoney || paying}
                  aria-label={t("tre.payOutAria", { currency: b.currency })}
                  onClick={() => setConfirming(b)}
                  className={`mt-auto ${b.currency === primary ? primaryBtn : secondaryBtn}`}
                >
                  {hasMoney ? t("tre.payOut") : t("tre.nothingToPay")}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <AutoPayoutToggle initial={autoProposals} />

      <GigLedgerGrid period={period} tab={parseGigLedgerTab(tab)} headingLevel={2} />

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
            <p>{t("fl.earn.confirmBody", { amount: confirming.available.display })}</p>
            <p className="text-sm text-ink-3">{t("fl.earn.confirmNote")}</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
