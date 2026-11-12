"use client";

import { useId, useState } from "react";
import { api, ApiError, type Money } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";

/**
 * The client's milestone plan for a fixed total (the price of a proposal). Rows have a title, an optional amount and an optional due date in
 * days. Either every row has an amount, or none (the server splits the total
 * evenly). The browser never adds the amounts up: it sends the decimal strings
 * as typed and shows the server's verdict (POST /api/contracts), including the
 * total, the sum and the difference when they don't match.
 *
 *   <PlanEditor total={quote.total} source={{ quote_id }} onCreated={(id) => router.push(`${base}/projects/${id}`)} />
 */

type Row = { key: number; title: string; amount: string; days: string };
export type PlanSource = { quote_id: string };

const MAX = 10;
const DECIMAL = /^\d+(\.\d+)?$/;

let seq = 0;
const row = (title = ""): Row => ({ key: ++seq, title, amount: "", days: "" });

export function PlanEditor({ total, source, onCreated, onCancel }: { total: Money; source: PlanSource; onCreated: (contractId: string) => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const [rows, setRows] = useState<Row[]>(() => [row(t("cl.plan.defaultTitle", { n: 1 }))]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<{ total?: string; sum?: string; diff?: string } | null>(null);

  const filled = rows.filter((r) => r.amount.trim() !== "").length;
  const mixed = filled > 0 && filled < rows.length;
  const badAmount = rows.some((r) => r.amount.trim() !== "" && !DECIMAL.test(r.amount.trim()));
  const badTitle = rows.some((r) => !r.title.trim());

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mixed || badAmount || badTitle) return;
    setBusy(true);
    setError(null);
    setDetails(null);
    try {
      const milestones = rows.map((r) => ({
        title: r.title.trim(),
        description: null,
        amount: r.amount.trim() === "" ? null : r.amount.trim(),
        due_in_days: r.days.trim() === "" ? null : Number(r.days),
      }));
      const res = await api<{ contract_id: string }>("/api/contracts", { body: { ...source, milestones } });
      onCreated(res.contract_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cl.err.generic"));
      if (err instanceof ApiError && err.details) {
        const d = err.details as { total?: Money; milestones_sum?: Money; difference?: Money };
        if (d.total || d.milestones_sum) setDetails({ total: d.total?.display, sum: d.milestones_sum?.display, diff: d.difference?.display });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-[10px] border border-rule bg-sheet-2 p-4" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 id={`${id}-title`} className="font-display text-lg font-semibold">
          {t("cl.plan.title")}
        </h3>
        <p className="text-sm">
          <span className="text-ink-3">{t("cl.plan.fixedTotal")}</span> <span className="num font-display text-xl font-semibold">{total.display}</span>
        </p>
      </div>
      <p className="max-w-[70ch] text-sm text-ink-2">{t("cl.plan.intro")}</p>

      <ol className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.key} className="grid gap-2 rounded-md border border-rule bg-sheet p-3 bq-md:grid-cols-[2rem_minmax(0,1fr)_9rem_7rem_auto] bq-md:items-end">
            <span className="num font-display text-lg font-semibold text-ink-3 bq-md:pb-2.5" aria-hidden>
              {i + 1}
            </span>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("cl.plan.rowTitle", { n: i + 1 })}</span>
              <input
                value={r.title}
                maxLength={140}
                required
                onChange={(e) => update(r.key, { title: e.target.value })}
                className="min-h-11 rounded-md border border-rule-strong bg-sheet px-3 focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("cl.plan.amount", { currency: total.currency })}</span>
              <input
                value={r.amount}
                inputMode="decimal"
                placeholder={t("cl.plan.amountPh")}
                aria-invalid={r.amount.trim() !== "" && !DECIMAL.test(r.amount.trim())}
                onChange={(e) => update(r.key, { amount: e.target.value })}
                className="num min-h-11 rounded-md border border-rule-strong bg-sheet px-3 focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("cl.plan.days")}</span>
              <input
                type="number"
                min={1}
                max={365}
                value={r.days}
                placeholder={t("cl.plan.daysPh")}
                onChange={(e) => update(r.key, { days: e.target.value })}
                className="num min-h-11 rounded-md border border-rule-strong bg-sheet px-3 focus:border-accent"
              />
            </label>
            <button
              type="button"
              disabled={rows.length === 1}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              className="inline-flex min-h-11 items-center justify-self-start rounded-md px-3 text-sm text-ink-3 hover:text-alert-ink hover:underline disabled:opacity-40"
              aria-label={t("cl.plan.removeRow", { n: i + 1 })}
            >
              {t("cl.plan.remove")}
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={rows.length >= MAX}
          onClick={() => setRows((rs) => [...rs, row(t("cl.plan.defaultTitle", { n: rs.length + 1 }))])}
          className="inline-flex min-h-11 items-center rounded-md border border-rule-strong bg-sheet px-4 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {t("cl.plan.add")}
        </button>
        <span className="text-sm text-ink-3">{filled === 0 ? t("cl.plan.evenSplit", { n: rows.length }) : t("cl.plan.ownAmounts")}</span>
      </div>

      {mixed && (
        <p role="status" className="rounded-md bg-gold-soft px-3 py-2 text-sm text-gold-ink">
          {t("cl.plan.mixed")}
        </p>
      )}
      {badAmount && (
        <p role="status" className="rounded-md bg-gold-soft px-3 py-2 text-sm text-gold-ink">
          {t("cl.plan.badAmount")}
        </p>
      )}
      {error && (
        <div role="alert" className="rounded-md bg-alert-soft px-3 py-2 text-sm text-alert-ink">
          <p>{error}</p>
          {details && (
            <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
              {details.total && (
                <>
                  <dt>{t("cl.plan.errTotal")}</dt>
                  <dd className="num">{details.total}</dd>
                </>
              )}
              {details.sum && (
                <>
                  <dt>{t("cl.plan.errSum")}</dt>
                  <dd className="num">{details.sum}</dd>
                </>
              )}
              {details.diff && (
                <>
                  <dt>{t("cl.plan.errDiff")}</dt>
                  <dd className="num">{details.diff}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}

      <p className="text-xs text-ink-3">{t("cl.plan.nothingCharged")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium text-ink-2 hover:bg-sheet">
            {t("cl.common.cancel")}
          </button>
        )}
        <button type="submit" disabled={busy || mixed || badAmount || badTitle} className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-sm font-semibold text-sheet disabled:opacity-50">
          {busy ? t("cl.plan.saving") : t("cl.plan.save")}
        </button>
      </div>
    </form>
  );
}
