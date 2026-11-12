"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { api, type Money } from "@/components/api";
import { usePageAssistant } from "@/components/assistant/AssistantContext";
import { dateText, errText, field, h1Cls, Notice, Skeleton } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useBase } from "@/lib/use-base";

/** The project board: open projects from clients (best match first) and the freelancer's own proposals. */

export type BoardProject = {
  brief_id: string;
  title: string;
  description: string;
  written_in: string;
  skills: string[];
  budget: Money | null;
  deadline: string | null;
  client: string;
  market: string;
  matching_skills: string[];
  proposals: number;
  my_proposal: { quote_id: string; status: string } | null;
};
type Proposal = { quote_id: string; status: string; brief_id: string | null; brief_title: string | null; total: Money | null; delivery_days: number | null; sent_at: string | null };

const TABS = ["open", "mine"] as const;
type Tab = (typeof TABS)[number];

export function BoardView() {
  const { t, locale } = useI18n();
  const base = useBase();
  const searchId = useId();
  const initial = useSearchParams().get("tab") === "mine" ? "mine" : "open";
  const [tab, setTab] = useState<Tab>(initial);
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState<BoardProject[] | null>(null);
  const [mine, setMine] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageAssistant({ agent: "PROFILE" });

  useEffect(() => {
    if (tab !== "open") return;
    let live = true;
    const timer = setTimeout(
      () => {
        api<{ projects: BoardProject[] }>(`/api/projects/open${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`).then(
          (r) => {
            if (!live) return;
            setProjects(r.projects);
            setError(null);
          },
          (e: unknown) => live && setError(errText(e, t("fl.error"))),
        );
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tab, q, t]);

  useEffect(() => {
    if (tab !== "mine" || mine !== null) return;
    api<{ quotes: Proposal[] }>("/api/quotes").then(
      (r) => setMine(r.quotes),
      (e: unknown) => setError(errText(e, t("fl.error"))),
    );
  }, [tab, mine, t]);

  const tabCls = (on: boolean) => `inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium ${on ? "bg-ink text-sheet" : "border border-rule-strong text-ink-2 hover:border-accent hover:text-accent"}`;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="max-w-2xl">
        <h1 className={h1Cls}>{t("pj.board.title")}</h1>
        <p className="mt-1 text-ink-3">{t("pj.board.intro")}</p>
      </header>

      <div role="group" aria-label={t("pj.board.title")} className="flex flex-wrap items-center gap-2">
        {TABS.map((x) => (
          <button key={x} type="button" aria-pressed={tab === x} onClick={() => setTab(x)} className={tabCls(tab === x)}>
            {x === "open" ? t("pj.board.tabOpen") : t("pj.board.tabMine")}
          </button>
        ))}
        {tab === "open" && (
          <div className="ml-auto w-full max-w-sm">
            <label htmlFor={searchId} className="sr-only">
              {t("pj.board.search")}
            </label>
            <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pj.board.search")} className={field} />
          </div>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {tab === "open" &&
        (projects === null ? (
          <Skeleton />
        ) : projects.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-rule-strong bg-sheet px-6 py-10 text-ink-3">{t("pj.board.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {projects.map((p) => (
              <li key={p.brief_id} className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg leading-snug font-semibold">{p.title}</h2>
                    <p className="mt-0.5 text-sm text-ink-3">{t("pj.board.client", { client: p.client })}</p>
                  </div>
                  <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-ink-3">{t("pj.board.budget")}</dt>
                    <dd className="num font-semibold">{p.budget?.display ?? t("pj.board.noBudget")}</dd>
                    {p.deadline && (
                      <>
                        <dt className="text-ink-3">{t("pj.board.deadline")}</dt>
                        <dd className="num">{dateText(p.deadline, locale)}</dd>
                      </>
                    )}
                  </dl>
                </div>
                <p className="mt-3 line-clamp-3 text-sm whitespace-pre-line text-ink-2">{p.description}</p>
                {p.skills.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("cl.brief.skills")}>
                    {p.skills.map((s) => (
                      <li key={s} className={`rounded-full border px-2.5 py-0.5 text-xs ${p.matching_skills.includes(s) ? "border-accent bg-accent-soft text-accent-ink" : "border-rule-strong text-ink-2"}`}>
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-3">
                    {p.my_proposal ? <span className="font-medium text-positive-ink">{t("pj.board.sent")}</span> : p.proposals === 0 ? t("pj.board.proposalsNone") : p.proposals === 1 ? t("pj.board.proposalsOne") : t("pj.board.proposalsN", { n: p.proposals })}
                  </p>
                  <Link href={`${base}/board/${p.brief_id}`} className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-sheet">
                    {t("pj.board.view")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {tab === "mine" &&
        (mine === null ? (
          <Skeleton h="h-24" />
        ) : mine.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-rule-strong bg-sheet px-6 py-10 text-ink-3">{t("pj.board.mineEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((p) => (
              <li key={p.quote_id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-rule bg-sheet p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.brief_title ?? t("cl.quote.freelancer")}</p>
                  <p className="text-sm text-ink-3">
                    {t(`cl.quote.status.${p.status as "SENT"}`)}
                    {p.sent_at ? ` · ${dateText(p.sent_at, locale)}` : ""}
                    {p.delivery_days ? ` · ${t("cl.quote.days", { n: p.delivery_days })}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {p.total && <span className="num font-display text-lg font-semibold">{p.total.display}</span>}
                  {p.brief_id && (
                    <Link href={`${base}/board/${p.brief_id}`} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent">
                      {t("pj.board.view")}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
