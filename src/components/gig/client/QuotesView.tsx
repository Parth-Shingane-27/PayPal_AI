"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type Money } from "../../api";
import { ConfirmDialog } from "../../ConfirmDialog";
import { useI18n } from "../../i18n/I18nProvider";
import { useGigBase } from "../use-gig-base";
import { PlanEditor } from "./PlanEditor";

/**
 * The client's quotes by status. A SENT price can be turned into a milestone
 * plan (POST /api/contracts {quote_id, milestones}) or declined; a REQUESTED
 * one can be withdrawn (DELETE /api/quotes/<id>).
 */

export type QuoteRow = {
  quote_id: string;
  status: "REQUESTED" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN" | string;
  brief_id: string | null;
  request_message: string;
  total: Money | null;
  delivery_days: number | null;
  revisions: number | null;
  scope: string | null;
  message: string | null;
  requested_at: string;
  sent_at: string | null;
  expires_at: string | null;
  freelancer?: { name: string };
};

const GROUPS = [
  { key: "SENT", statuses: ["SENT"] },
  { key: "REQUESTED", statuses: ["REQUESTED"] },
  { key: "ACCEPTED", statuses: ["ACCEPTED"] },
  { key: "CLOSED", statuses: ["DECLINED", "EXPIRED", "WITHDRAWN"] },
] as const;

const STATUS_CLS: Record<string, string> = {
  SENT: "bg-gold-soft text-gold-ink",
  REQUESTED: "bg-sheet-2 text-ink-2",
  ACCEPTED: "bg-positive-soft text-positive-ink",
  DECLINED: "bg-sheet-2 text-ink-3",
  EXPIRED: "bg-sheet-2 text-ink-3",
  WITHDRAWN: "bg-sheet-2 text-ink-3",
};

function QuoteStatus({ status }: { status: string }) {
  const { t } = useI18n();
  const known = status in STATUS_CLS;
  return (
    <span className={`inline-flex items-center rounded-[3px] px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[status] ?? "bg-sheet-2 text-ink-2"}`}>
      {known ? t(`cl.quote.status.${status as "SENT"}`) : status}
    </span>
  );
}

export function QuotesView({ quotes, briefTitles }: { quotes: QuoteRow[]; briefTitles: Record<string, string> }) {
  const { t, locale } = useI18n();
  const base = useGigBase();
  const router = useRouter();
  const [planning, setPlanning] = useState<string | null>(null);
  const [closing, setClosing] = useState<QuoteRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

  async function closeQuote() {
    if (!closing) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/quotes/${closing.quote_id}`, { method: "DELETE" });
      setNotice(closing.status === "REQUESTED" ? t("cl.quote.withdrawn") : t("cl.quote.declined"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cl.err.generic"));
    } finally {
      setClosing(null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("cl.quote.pageTitle")}</h1>
        <p className="mt-1 max-w-[65ch] text-ink-3">{t("cl.quote.intro")}</p>
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
      {quotes.length === 0 && (
        <div className="flex flex-col items-start gap-2 rounded-[12px] border border-dashed border-rule-strong bg-sheet px-6 py-10">
          <h2 className="font-display text-xl font-semibold">{t("cl.quote.emptyTitle")}</h2>
          <p className="max-w-[52ch] text-ink-3">{t("cl.quote.emptyBody")}</p>
        </div>
      )}

      {GROUPS.map((g) => {
        const rows = quotes.filter((q) => (g.statuses as readonly string[]).includes(q.status));
        if (rows.length === 0) return null;
        return (
          <section key={g.key} aria-labelledby={`q-${g.key}`}>
            <h2 id={`q-${g.key}`} className="font-display mb-3 text-xl font-semibold">
              {t(`cl.quote.group.${g.key}`)} <span className="num text-base font-normal text-ink-3">({rows.length})</span>
            </h2>
            <ul className="flex flex-col gap-4">
              {rows.map((q) => (
                <li key={q.quote_id} className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-lg font-semibold">{q.freelancer?.name ?? t("cl.quote.freelancer")}</span>
                        <QuoteStatus status={q.status} />
                      </p>
                      <p className="mt-0.5 text-sm text-ink-3">
                        {t("cl.quote.requested", { date: date(q.requested_at) })}
                        {q.brief_id && briefTitles[q.brief_id] ? ` · ${t("cl.quote.forBrief", { title: briefTitles[q.brief_id]! })}` : ""}
                      </p>
                    </div>
                    {q.total && <p className="num font-display text-2xl font-semibold">{q.total.display}</p>}
                  </div>

                  <details className="mt-3 text-sm">
                    <summary className="min-h-11 cursor-pointer py-2 text-ink-2">{t("cl.quote.yourRequest")}</summary>
                    <p className="whitespace-pre-line text-ink-2">{q.request_message}</p>
                  </details>

                  {q.status === "SENT" && (
                    <div className="mt-3 flex flex-col gap-3">
                      <dl className="grid gap-x-6 gap-y-1 text-sm bq-sm:grid-cols-[auto_minmax(0,1fr)]">
                        <dt className="text-ink-3">{t("cl.quote.delivery")}</dt>
                        <dd>{t("cl.quote.days", { n: q.delivery_days ?? 0 })}</dd>
                        <dt className="text-ink-3">{t("cl.quote.revisions")}</dt>
                        <dd className="num">{q.revisions ?? 0}</dd>
                        {q.expires_at && (
                          <>
                            <dt className="text-ink-3">{t("cl.quote.validUntil")}</dt>
                            <dd>{date(q.expires_at)}</dd>
                          </>
                        )}
                      </dl>
                      {q.scope && (
                        <div>
                          <h3 className="text-sm font-semibold">{t("cl.quote.scope")}</h3>
                          <p className="mt-1 text-sm whitespace-pre-line text-ink-2">{q.scope}</p>
                        </div>
                      )}
                      {q.message && (
                        <blockquote className="border-l-2 border-accent pl-3 text-sm text-ink-2">
                          <p className="text-xs font-semibold text-ink-3">{t("cl.quote.note", { name: q.freelancer?.name ?? t("cl.quote.freelancer") })}</p>
                          <p className="mt-1 whitespace-pre-line">{q.message}</p>
                        </blockquote>
                      )}
                      {planning === q.quote_id && q.total ? (
                        <PlanEditor total={q.total} source={{ quote_id: q.quote_id }} onCreated={(id) => router.push(`${base}/projects/${id}`)} onCancel={() => setPlanning(null)} />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setPlanning(q.quote_id)} className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-sm font-semibold text-sheet">
                            {t("cl.quote.plan")}
                          </button>
                          <button type="button" onClick={() => setClosing(q)} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium text-ink-2 hover:border-alert hover:text-alert-ink">
                            {t("cl.quote.decline")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {q.status === "REQUESTED" && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <p className="text-sm text-ink-3">{t("cl.quote.waiting")}</p>
                      <button type="button" onClick={() => setClosing(q)} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium text-ink-2 hover:border-alert hover:text-alert-ink">
                        {t("cl.quote.withdraw")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <ConfirmDialog
        open={closing !== null}
        title={closing?.status === "REQUESTED" ? t("cl.quote.withdrawTitle") : t("cl.quote.declineTitle")}
        confirmLabel={closing?.status === "REQUESTED" ? t("cl.quote.withdraw") : t("cl.quote.decline")}
        cancelLabel={t("cl.common.keep")}
        busy={busy}
        onConfirm={closeQuote}
        onCancel={() => setClosing(null)}
      >
        <p>{closing?.status === "REQUESTED" ? t("cl.quote.withdrawBody") : t("cl.quote.declineBody", { name: closing?.freelancer?.name ?? t("cl.quote.freelancer") })}</p>
      </ConfirmDialog>
    </div>
  );
}
