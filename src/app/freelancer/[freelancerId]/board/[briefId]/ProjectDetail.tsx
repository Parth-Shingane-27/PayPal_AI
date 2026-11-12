"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { api, ApiError, decimalOf, type Money } from "@/components/api";
import { openAssistant, usePageAssistant } from "@/components/assistant/AssistantContext";
import { dateText, errText, field, h1Cls, labelCls, Notice, primaryBtn, secondaryBtn, Skeleton } from "@/components/gig/freelancer/shared";
import { languageName } from "@/components/gig/client/format";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useBase } from "@/lib/use-base";
import type { BoardProject } from "../BoardView";

type Project = BoardProject & { currency: string };
type Mine = { quote_id: string; status: string; total: Money | null; delivery_days: number | null; revisions: number | null; scope: string | null; message: string | null };

const DECIMAL = /^\d+(\.\d+)?$/;

/** One open project, with the proposal form (POST /api/briefs/<id>/proposals) and the assistant for pricing. */
export function ProjectDetail({ briefId }: { briefId: string }) {
  const { t, locale } = useI18n();
  const base = useBase();
  const id = useId();
  const [project, setProject] = useState<Project | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState("");
  const [days, setDays] = useState("14");
  const [revisions, setRevisions] = useState("2");
  const [scope, setScope] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(
    () =>
      api<Project>(`/api/projects/open/${briefId}`)
        .then(async (p) => {
          setProject(p);
          if (p.my_proposal) {
            const q = await api<Mine>(`/api/quotes/${p.my_proposal.quote_id}`);
            setMine(q);
            if (q.status === "SENT") {
              if (q.total) setTotal(decimalOf(q.total));
              if (q.delivery_days) setDays(String(q.delivery_days));
              if (q.revisions !== null) setRevisions(String(q.revisions));
              setScope(q.scope ?? "");
              setMessage(q.message ?? "");
            }
          } else setMine(null);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof ApiError && e.status === 404 ? t("pj.board.closed") : errText(e, t("fl.error")))),
    [briefId, t],
  );
  useEffect(() => {
    void load();
  }, [load]);

  usePageAssistant({ agent: "PROFILE", subjectId: briefId, contextLabel: project?.title, onResult: () => void load() });

  const sent = mine?.status === "SENT";
  const badTotal = total.trim() !== "" && !DECIMAL.test(total.trim());
  const ready = DECIMAL.test(total.trim()) && Number(days) >= 1 && Number(revisions) >= 0 && scope.trim().length >= 10;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !project) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await api(`/api/briefs/${project.brief_id}/proposals`, {
        body: { total: total.trim(), delivery_days: Number(days), revisions: Number(revisions), scope: scope.trim(), message: message.trim() || null },
      });
      setNotice(sent ? t("pj.prop.updatedOk") : t("pj.prop.sentOk"));
      await load();
    } catch (err) {
      setError(errText(err, t("fl.error")));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!mine) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/quotes/${mine.quote_id}`, { method: "DELETE" });
      setNotice(t("pj.prop.withdrawn"));
      setTotal("");
      setScope("");
      setMessage("");
      await load();
    } catch (err) {
      setError(errText(err, t("fl.error")));
    } finally {
      setBusy(false);
    }
  }

  if (!project) {
    return (
      <div className="flex flex-col gap-4">
        <Link href={`${base}/board`} className="text-sm text-accent hover:underline">
          ← {t("pj.board.back")}
        </Link>
        {error ? <Notice tone="error">{error}</Notice> : <Skeleton />}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Link href={`${base}/board`} className="text-sm text-accent hover:underline">
        ← {t("pj.board.back")}
      </Link>
      <header>
        <h1 className={h1Cls}>{project.title}</h1>
        <p className="mt-1 text-ink-3">
          {t("pj.board.client", { client: project.client })} · {t("pj.board.written", { lang: languageName(project.written_in.slice(0, 2), locale) })}
        </p>
      </header>

      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-5 cq-lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <section aria-labelledby={`${id}-d`} className="min-w-0 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
          <h2 id={`${id}-d`} className="font-display text-lg font-semibold">
            {t("pj.board.description")}
          </h2>
          <p className="mt-2 text-sm whitespace-pre-line text-ink-2">{project.description}</p>
          <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-3">{t("pj.board.budget")}</dt>
            <dd className="num font-semibold">{project.budget?.display ?? t("pj.board.noBudget")}</dd>
            {project.deadline && (
              <>
                <dt className="text-ink-3">{t("pj.board.deadline")}</dt>
                <dd className="num">{dateText(project.deadline, locale)}</dd>
              </>
            )}
          </dl>
          {project.skills.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("cl.brief.skills")}>
              {project.skills.map((s) => (
                <li key={s} className={`rounded-full border px-2.5 py-0.5 text-xs ${project.matching_skills.includes(s) ? "border-accent bg-accent-soft text-accent-ink" : "border-rule-strong text-ink-2"}`}>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby={`${id}-ask`} className="rounded-[10px] border border-rule bg-accent-soft p-4 md:p-5">
            <h2 id={`${id}-ask`} className="font-display text-lg font-semibold text-accent-ink">
              {t("pj.prop.askTitle")}
            </h2>
            <p className="mt-1 text-sm text-accent-ink">{t("pj.prop.askBody")}</p>
            <button type="button" onClick={() => openAssistant({ agent: "PROFILE" })} className={`mt-3 ${secondaryBtn} bg-sheet`}>
              {t("pj.prop.ask")}
            </button>
          </section>

          {mine && mine.status !== "SENT" ? (
            <Notice tone="info">{t(`cl.quote.status.${mine.status as "SENT"}`)}</Notice>
          ) : (
            <form onSubmit={send} aria-labelledby={`${id}-f`} className="flex flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
              <h2 id={`${id}-f`} className="font-display text-lg font-semibold">
                {t("pj.prop.title")}
              </h2>
              <label className={labelCls}>
                <span className="font-medium">{t("pj.prop.total", { currency: project.currency })}</span>
                <input value={total} inputMode="decimal" aria-invalid={badTotal} onChange={(e) => setTotal(e.target.value)} className={`num ${field}`} />
                <span className="text-xs text-ink-3">{badTotal ? t("cl.plan.badAmount") : t("pj.prop.totalHint")}</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>
                  <span className="font-medium">{t("pj.prop.days")}</span>
                  <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={`num ${field}`} />
                </label>
                <label className={labelCls}>
                  <span className="font-medium">{t("pj.prop.revisions")}</span>
                  <input type="number" min={0} max={20} value={revisions} onChange={(e) => setRevisions(e.target.value)} className={`num ${field}`} />
                </label>
              </div>
              <label className={labelCls}>
                <span className="font-medium">{t("pj.prop.scope")}</span>
                <textarea rows={5} value={scope} maxLength={4000} onChange={(e) => setScope(e.target.value)} placeholder={t("pj.prop.scopePh")} className={`${field} py-2`} />
              </label>
              <label className={labelCls}>
                <span className="font-medium">{t("pj.prop.message")}</span>
                <textarea rows={3} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} className={`${field} py-2`} />
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                {sent && (
                  <button type="button" disabled={busy} onClick={() => void withdraw()} className={secondaryBtn}>
                    {t("pj.prop.withdraw")}
                  </button>
                )}
                <button type="submit" disabled={busy || !ready} className={primaryBtn}>
                  {busy ? t("pj.prop.sending") : sent ? t("pj.prop.update") : t("pj.prop.send")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
