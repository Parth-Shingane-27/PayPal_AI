"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { api, decimalOf, type Money } from "../../api";
import { ConfirmDialog } from "../../ConfirmDialog";
import { useI18n } from "../../i18n/I18nProvider";
import { useGigBase } from "../use-gig-base";

/** The client's briefs: write, edit and close them (POST/PUT/DELETE /api/briefs). */

export type BriefRow = {
  brief_id: string;
  title: string;
  description: string;
  written_in: string;
  skills: string[];
  budget: Money | null;
  deadline: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED" | string;
  updated_at: string;
  quotes: number;
};

const fieldCls = "min-h-11 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent";
const DECIMAL = /^\d+(\.\d+)?$/;

function StatusTag({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = status === "OPEN" ? "bg-positive-soft text-positive-ink" : status === "CLOSED" ? "bg-sheet-2 text-ink-3" : "bg-gold-soft text-gold-ink";
  const label = status === "OPEN" || status === "CLOSED" || status === "DRAFT" ? t(`cl.brief.status.${status}`) : status;
  return <span className={`inline-flex items-center rounded-[3px] px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function BriefForm({ brief, currency, onDone, onCancel }: { brief?: BriefRow; currency: string; onDone: () => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const sameCurrency = !brief?.budget || brief.budget.currency === currency;
  const [title, setTitle] = useState(brief?.title ?? "");
  const [description, setDescription] = useState(brief?.description ?? "");
  const [skills, setSkills] = useState((brief?.skills ?? []).join(", "));
  const [budget, setBudget] = useState(brief?.budget && sameCurrency ? decimalOf(brief.budget) : "");
  const [deadline, setDeadline] = useState(brief?.deadline ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badBudget = budget.trim() !== "" && !DECIMAL.test(budget.trim());

  return (
    <form
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 md:p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (badBudget) return;
        setBusy(true);
        setError(null);
        try {
          const body = {
            title: title.trim(),
            description: description.trim(),
            skills: skills
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 15),
            budget: budget.trim() === "" ? null : budget.trim(),
            deadline: deadline || null,
          };
          if (brief) await api(`/api/briefs/${brief.brief_id}`, { method: "PUT", body });
          else await api("/api/briefs", { body });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : t("cl.err.generic"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id={`${id}-h`} className="font-display text-lg font-semibold">
        {brief ? t("cl.brief.editTitle") : t("cl.brief.newTitle")}
      </h2>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("cl.brief.title")}</span>
        <input value={title} required minLength={3} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder={t("cl.brief.titlePh")} className={fieldCls} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("cl.brief.description")}</span>
        <textarea
          rows={6}
          value={description}
          required
          minLength={10}
          maxLength={6000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("cl.brief.descriptionPh")}
          className={fieldCls}
        />
        <span className="text-xs text-ink-3">{t("cl.brief.anyLanguage")}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("cl.brief.skills")}</span>
        <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder={t("cl.brief.skillsPh")} className={fieldCls} />
      </label>
      <div className="grid gap-3 bq-sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("cl.brief.budget", { currency })}</span>
          <input value={budget} inputMode="decimal" aria-invalid={badBudget} onChange={(e) => setBudget(e.target.value)} placeholder={t("cl.plan.amountPh")} className={`num ${fieldCls}`} />
          {badBudget ? <span className="text-xs text-alert-ink">{t("cl.plan.badAmount")}</span> : <span className="text-xs text-ink-3">{t("cl.brief.budgetHint")}</span>}
          {!sameCurrency && brief?.budget && <span className="text-xs text-gold-ink">{t("cl.brief.otherCurrency", { budget: brief.budget.display, currency })}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("cl.brief.deadline")}</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={fieldCls} />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft px-3 py-2 text-sm text-alert-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium text-ink-2 hover:bg-sheet-2">
            {t("cl.common.cancel")}
          </button>
        )}
        <button type="submit" disabled={busy || badBudget} className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-sm font-semibold text-sheet disabled:opacity-50">
          {busy ? t("cl.common.saving") : brief ? t("cl.common.save") : t("cl.brief.create")}
        </button>
      </div>
    </form>
  );
}

export function BriefsView({ briefs, currency }: { briefs: BriefRow[]; currency: string }) {
  const { t, locale } = useI18n();
  const base = useGigBase();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [closing, setClosing] = useState<BriefRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

  const done = (msg: string) => {
    setCreating(false);
    setEditing(null);
    setNotice(msg);
    router.refresh();
  };

  async function close() {
    if (!closing) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/briefs/${closing.brief_id}`, { method: "DELETE" });
      setClosing(null);
      done(t("cl.brief.closed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cl.err.generic"));
      setClosing(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("cl.brief.pageTitle")}</h1>
          <p className="mt-1 max-w-[65ch] text-ink-3">{t("cl.brief.intro")}</p>
        </div>
        {!creating && (
          <button type="button" onClick={() => (setCreating(true), setEditing(null), setNotice(null))} className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-sheet">
            {t("cl.brief.new")}
          </button>
        )}
      </header>

      {notice && (
        <p role="status" className="rounded-md bg-positive-soft px-4 py-2.5 text-sm text-positive-ink">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft px-4 py-2.5 text-sm text-alert-ink">
          {error}
        </p>
      )}

      {creating && <BriefForm currency={currency} onDone={() => done(t("cl.brief.saved"))} onCancel={() => setCreating(false)} />}

      {briefs.length === 0 && !creating ? (
        <div className="flex flex-col items-start gap-3 rounded-[12px] border border-dashed border-rule-strong bg-sheet px-6 py-10">
          <h2 className="font-display text-xl font-semibold">{t("cl.brief.emptyTitle")}</h2>
          <p className="max-w-[52ch] text-ink-3">{t("cl.brief.emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {briefs.map((b) =>
            editing === b.brief_id ? (
              <li key={b.brief_id}>
                <BriefForm brief={b} currency={currency} onDone={() => done(t("cl.brief.saved"))} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={b.brief_id} className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-lg leading-snug font-semibold">{b.title}</h2>
                      <StatusTag status={b.status} />
                    </div>
                    <p className="mt-1 text-sm text-ink-3">
                      {t("cl.brief.updated", { date: date(b.updated_at) })} · {b.quotes === 1 ? t("cl.brief.quoteOne") : t("cl.brief.quotes", { n: b.quotes })}
                    </p>
                  </div>
                  <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-ink-3">{t("cl.brief.budgetShort")}</dt>
                    <dd className="num font-semibold">{b.budget?.display ?? t("cl.brief.noBudget")}</dd>
                    <dt className="text-ink-3">{t("cl.brief.deadline")}</dt>
                    <dd className="num">{b.deadline ? date(b.deadline) : t("cl.brief.noDeadline")}</dd>
                  </dl>
                </div>
                <p className="mt-3 line-clamp-4 text-sm whitespace-pre-line text-ink-2">{b.description}</p>
                {b.skills.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("cl.brief.skills")}>
                    {b.skills.map((s) => (
                      <li key={s} className="rounded-full border border-rule-strong px-2.5 py-0.5 text-xs text-ink-2">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {b.status !== "CLOSED" && (
                    <>
                      <Link href={`${base}/find?q=${encodeURIComponent(b.title)}`} className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-sheet">
                        {t("cl.brief.findFor")}
                      </Link>
                      <button
                        type="button"
                        onClick={() => (setEditing(b.brief_id), setCreating(false), setNotice(null))}
                        className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent"
                      >
                        {t("cl.common.edit")}
                      </button>
                      <button type="button" onClick={() => setClosing(b)} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-ink-3 hover:text-alert-ink hover:underline">
                        {t("cl.brief.close")}
                      </button>
                    </>
                  )}
                  {b.quotes > 0 && (
                    <Link href={`${base}/quotes`} className="inline-flex min-h-11 items-center px-2 text-sm text-accent hover:underline">
                      {t("cl.find.seeQuotes")}
                    </Link>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <ConfirmDialog
        open={closing !== null}
        title={t("cl.brief.closeTitle")}
        confirmLabel={t("cl.brief.close")}
        cancelLabel={t("cl.common.keep")}
        busy={busy}
        onConfirm={close}
        onCancel={() => setClosing(null)}
      >
        <p>{t("cl.brief.closeBody", { title: closing?.title ?? "" })}</p>
      </ConfirmDialog>
    </div>
  );
}
