"use client";

import { useId, useState } from "react";
import { api, decimalOf, type Money } from "./api";
import { useT } from "./i18n/I18nProvider";

/**
 * Refund through PayPal now. The amount defaults to everything still
 * refundable; the seller can lower it for a partial refund.
 */
export function RefundForm({ orderId, refundable, onDone }: { orderId: string; refundable: Money; onDone: () => void }) {
  const t = useT();
  const [amount, setAmount] = useState(decimalOf(refundable));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const amountId = useId();
  const reasonId = useId();
  if (refundable.amount_minor <= 0) return null;

  async function refund(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(t("refund.confirm", { amount: `${amount} ${refundable.currency}` }))) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<{ status: string; error?: string | null }>(`/api/orders/${orderId}/refund`, { body: { amount, reason } });
      setNotice(r.status === "EXECUTED" ? { tone: "ok", text: t("refund.done") } : { tone: "error", text: r.error ?? `${t("refund.failed")} (${r.status})` });
      onDone();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : t("refund.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 rounded-[10px] border border-rule bg-paper p-4" onSubmit={refund}>
      <p className="font-semibold">{t("refund.title")}</p>
      <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
        <label htmlFor={amountId} className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">{t("refund.amount", { currency: refundable.currency })}</span>
          <input
            id={amountId}
            className="num min-h-11 rounded-md border border-rule-strong bg-sheet px-3 text-ink focus:border-accent"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label htmlFor={reasonId} className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">{t("refund.reason")}</span>
          <input
            id={reasonId}
            className="min-h-11 rounded-md border border-rule-strong bg-sheet px-3 text-ink placeholder:text-ink-3 focus:border-accent"
            placeholder={t("refund.placeholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={500}
          />
        </label>
      </div>
      <p className="text-xs text-ink-3">{t("refund.upTo", { amount: refundable.display })}</p>
      <button className="min-h-11 rounded-md bg-alert px-4 font-semibold text-sheet hover:opacity-90 disabled:opacity-50" disabled={busy || !reason.trim()}>
        {busy ? t("refund.busy") : t("refund.button", { amount: `${amount} ${refundable.currency}` })}
      </button>
      {notice && (
        <p role="status" className={`rounded-md p-2.5 text-sm ${notice.tone === "ok" ? "bg-positive-soft text-positive-ink" : "bg-alert-soft text-alert-ink"}`}>
          {notice.text}
        </p>
      )}
    </form>
  );
}
