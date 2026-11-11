"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { dateText, errText, h1Cls, Notice, primaryBtn, secondaryBtn, Skeleton } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";

type Approval = {
  id: string;
  status: string;
  agent: string | null;
  tool: string;
  rationale: string | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  proposal: Record<string, unknown>;
  execution: unknown;
  refund: {
    contract: string;
    milestone: string;
    client: string;
    status: string;
    reason: string;
    from_holding: boolean;
    amount: Money;
    freelancer_debit: Money | null;
    error: string | null;
  } | null;
  payouts: { id: string; status: string; date: string; amount: Money; fee: Money; fee_is_estimate: boolean; error: string | null }[] | null;
};
type Decision = { status: string; error?: string | null; already_decided: boolean };

const STATUS_CLS: Record<string, string> = {
  PENDING_APPROVAL: "bg-gold-soft text-gold-ink",
  APPROVED: "bg-accent-soft text-ink",
  EXECUTED: "bg-positive-soft text-positive-ink",
  SUCCEEDED: "bg-positive-soft text-positive-ink",
  REJECTED: "bg-sheet-2 text-ink-2",
  EXECUTION_FAILED: "bg-alert-soft text-alert-ink",
  FAILED: "bg-alert-soft text-alert-ink",
};

const label = (t: (k: MessageKey) => string, prefix: string, v: string) => {
  const key = `${prefix}.${v}` as MessageKey;
  const s = t(key);
  return s === key ? v : s;
};

function ApprovalCard({ a, busy, onDecide }: { a: Approval; busy: boolean; onDecide: (a: Approval, d: "approve" | "reject") => void }) {
  const { t, locale } = useI18n();
  const pending = a.status === "PENDING_APPROVAL";
  const agent = a.agent ? label(t, "dock.agent", a.agent) : t("fl.appr.you");
  return (
    <li className={`rounded-[10px] border bg-sheet p-4 md:p-5 ${pending ? "border-gold-ink/50" : "border-rule"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-ink">{a.refund ? t("fl.appr.refund") : t("fl.appr.payouts")}</h2>
        <span className={`rounded-[3px] px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[a.status] ?? "bg-sheet-2 text-ink-2"}`}>{label(t, "fl.appr.status", a.status)}</span>
        <span className="text-xs text-ink-3">{t("fl.appr.proposedBy", { agent, date: dateText(a.created_at, locale, true) })}</span>
      </div>

      {a.refund && (
        <div className="mt-3 flex flex-col gap-1 text-sm">
          <p className="text-base">
            <span className="num font-display text-xl font-semibold">{a.refund.amount.display}</span> {t("fl.appr.toClient", { client: a.refund.client })}
          </p>
          <p className="text-ink-2">
            {a.refund.contract} · {a.refund.milestone}
          </p>
          <p className="text-ink-2">{t("fl.appr.reason", { reason: a.refund.reason })}</p>
          <p className={`mt-1 rounded-md px-3 py-2 ${a.refund.from_holding ? "bg-sheet-2 text-ink-2" : "bg-gold-soft text-gold-ink"}`}>
            {a.refund.from_holding
              ? t("fl.appr.fromHoldingLong")
              : a.refund.freelancer_debit
                ? t("fl.appr.debitLong", { amount: a.refund.freelancer_debit.display })
                : t("fl.appr.debitPending")}
          </p>
          <p className="text-xs text-ink-3">{t("fl.appr.refundStatus", { status: label(t, "fl.refund", a.refund.status) })}</p>
          {a.refund.error && <p className="text-sm text-alert-ink">{a.refund.error}</p>}
        </div>
      )}

      {a.payouts && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-ink-3">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t("col.date")}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  {t("shared.led.col.amount")}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  {t("fl.appr.fee")}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {t("col.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {a.payouts.map((p) => (
                <tr key={p.id} className="border-b border-rule align-top last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">{dateText(p.date, locale)}</td>
                  <td className="num py-2 pr-3 text-right font-semibold">{p.amount.display}</td>
                  <td className="num py-2 pr-3 text-right text-ink-2">
                    {p.fee.display}
                    {p.fee_is_estimate && <span className="text-xs text-ink-3"> ({t("cell.est")})</span>}
                  </td>
                  <td className="py-2">
                    {label(t, "fl.payout", p.status)}
                    {p.error && <span className="block text-xs text-alert-ink">{p.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.rationale && (
        <p className="mt-3 text-sm text-ink-2">
          <span className="font-medium text-ink">{t("fl.appr.rationale")}</span> {a.rationale}
        </p>
      )}
      {!pending && (
        <p className={`mt-3 text-sm ${a.error || a.status === "EXECUTION_FAILED" ? "text-alert-ink" : "text-ink-2"}`}>
          <span className="font-medium">{t("fl.appr.outcome")}</span> {a.error ?? label(t, "fl.appr.status", a.status)}
          {a.decided_at && <span className="text-ink-3"> · {dateText(a.decided_at, locale, true)}</span>}
        </p>
      )}
      <details className="mt-2 text-xs">
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-ink-3">{t("fl.appr.full")}</summary>
        <pre className="max-h-60 overflow-auto rounded bg-sheet-2 p-2">{JSON.stringify({ proposal: a.proposal, execution: a.execution }, null, 2)}</pre>
      </details>
      {pending && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={primaryBtn} onClick={() => onDecide(a, "approve")}>
            {t("fl.appr.approve")}
          </button>
          <button type="button" disabled={busy} className={secondaryBtn} onClick={() => onDecide(a, "reject")}>
            {t("fl.appr.reject")}
          </button>
        </div>
      )}
    </li>
  );
}

/** Agent proposals. Approving here is the only way a refund or payout schedule an agent drafted moves money. */
export function ApprovalsView() {
  const { t } = useI18n();
  const [items, setItems] = useState<Approval[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [asking, setAsking] = useState<{ a: Approval; d: "approve" | "reject" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<{ approvals: Approval[] }>("/api/freelancer/approvals").then(
        (r) => {
          setItems(r.approvals);
          setError(null);
        },
        (e: unknown) => setError(errText(e, t("fl.error"))),
      ),
    [t],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function decide() {
    if (!asking) return;
    setBusy(true);
    setNotice(null);
    try {
      const d = await api<Decision>(`/api/freelancer/approvals/${asking.a.id}/${asking.d}`, { method: "POST" });
      const status = label(t, "fl.appr.status", d.status);
      setNotice(
        d.already_decided
          ? { tone: "error", text: t("fl.appr.already", { status }) }
          : d.error
            ? { tone: "error", text: `${status}: ${d.error}` }
            : { tone: "ok", text: t("fl.appr.done", { status }) },
      );
    } catch (e) {
      setNotice({ tone: "error", text: errText(e, t("fl.error")) });
    } finally {
      setBusy(false);
      setAsking(null);
      void load();
    }
  }

  const pending = (items ?? []).filter((a) => a.status === "PENDING_APPROVAL");
  const decided = (items ?? []).filter((a) => a.status !== "PENDING_APPROVAL");
  const ask = asking?.a;

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className={h1Cls}>{t("nav.approvals")}</h1>
        <p className="mt-1 text-ink-3">{t("fl.appr.intro")}</p>
      </header>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!items && !error && <Skeleton />}
      {items && items.length === 0 && <p className="text-sm text-ink-3">{t("fl.appr.none")}</p>}
      {pending.length > 0 && (
        <section aria-label={t("fl.appr.waiting", { n: pending.length })}>
          <p className="mb-2 text-sm font-semibold text-ink">{t("fl.appr.waiting", { n: pending.length })}</p>
          <ul className="flex flex-col gap-3">
            {pending.map((a) => (
              <ApprovalCard key={a.id} a={a} busy={busy} onDecide={(x, d) => setAsking({ a: x, d })} />
            ))}
          </ul>
        </section>
      )}
      {decided.length > 0 && (
        <section aria-label={t("fl.appr.decided")}>
          <p className="mb-2 text-sm font-semibold text-ink">{t("fl.appr.decided")}</p>
          <ul className="flex flex-col gap-3">
            {decided.map((a) => (
              <ApprovalCard key={a.id} a={a} busy={busy} onDecide={() => undefined} />
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={asking !== null}
        title={asking?.d === "approve" ? (ask?.refund ? t("fl.appr.confirmRefund") : t("fl.appr.confirmPayouts")) : t("fl.appr.confirmReject")}
        confirmLabel={busy ? t("fl.working") : asking?.d === "approve" ? t("fl.appr.approve") : t("fl.appr.reject")}
        cancelLabel={t("form.cancel")}
        busy={busy}
        onConfirm={() => void decide()}
        onCancel={() => setAsking(null)}
      >
        {ask?.refund && asking?.d === "approve" && (
          <>
            <p>{t("fl.appr.confirmRefundBody", { amount: ask.refund.amount.display, client: ask.refund.client })}</p>
            <p className="text-sm text-ink-3">{ask.refund.from_holding ? t("fl.appr.fromHoldingLong") : t("fl.appr.debitPending")}</p>
          </>
        )}
        {ask?.payouts && asking?.d === "approve" && <p>{t("fl.appr.confirmPayoutsBody", { n: ask.payouts.length })}</p>}
        {asking?.d === "reject" && <p>{t("fl.appr.confirmRejectBody")}</p>}
      </ConfirmDialog>
    </div>
  );
}
