"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/i18n/I18nProvider";

/** Opt-in: Treasury may draft payout proposals by itself. They still wait for approval. */
export function AutoProposalsToggle() {
  const { t } = useI18n();
  const id = useId();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ auto_payout_proposals: boolean }>("/api/seller/settings")
      .then((r) => setOn(r.auto_payout_proposals))
      .catch(() => setOn(false));
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    setOn(next);
    try {
      const r = await api<{ auto_payout_proposals: boolean }>("/api/seller/settings", { method: "PATCH", body: { auto_payout_proposals: next } });
      setOn(r.auto_payout_proposals);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }

  if (on === null) return null;
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-rule bg-sheet px-4 py-3">
      <input id={id} type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => void change(e.target.checked)} className="mt-1 h-5 w-5 cursor-pointer accent-[var(--accent)]" />
      <label htmlFor={id} className="cursor-pointer">
        <span className="block font-medium">{t("find.auto.label")}</span>
        <span className="block text-sm text-ink-3">{t("find.auto.hint")}</span>
      </label>
    </div>
  );
}
