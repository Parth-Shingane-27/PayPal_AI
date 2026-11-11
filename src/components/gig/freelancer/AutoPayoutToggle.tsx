"use client";

import { useId, useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/i18n/I18nProvider";

/**
 * Opt-in: Treasury may draft payout proposals by itself (POST /api/freelancer/settings).
 * They still wait for the freelancer's approval. The settings route has no GET,
 * so the page passes the stored value in.
 */
export function AutoPayoutToggle({ initial }: { initial: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    setBusy(true);
    setFailed(false);
    setOn(next);
    try {
      const r = await api<{ auto_payout_proposals: boolean }>("/api/freelancer/settings", { body: { auto_payout_proposals: next } });
      setOn(r.auto_payout_proposals);
    } catch {
      setOn(!next);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-rule bg-sheet px-4 py-3">
      <input id={id} type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => void change(e.target.checked)} className="mt-1 h-5 w-5 cursor-pointer accent-[var(--accent)]" />
      <label htmlFor={id} className="cursor-pointer">
        <span className="block font-medium">{t("find.auto.label")}</span>
        <span className="block text-sm text-ink-3">{t("find.auto.hint")}</span>
        {failed && (
          <span role="alert" className="mt-1 block text-sm text-alert-ink">
            {t("fl.earn.toggleFailed")}
          </span>
        )}
      </label>
    </div>
  );
}
