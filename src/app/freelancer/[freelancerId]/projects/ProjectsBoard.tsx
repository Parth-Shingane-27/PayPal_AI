"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";
import { usePageAssistant } from "@/components/assistant/AssistantContext";
import { GigFindingsFeed } from "@/components/gig/GigFindingsFeed";
import { AutoReleaseCountdown, milestoneStateLabel } from "@/components/gig/MilestoneStamp";
import { dateText, errText, h1Cls, Notice } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CountryStamp } from "@/components/ui";
import { useBase } from "@/lib/use-base";

type Milestone = {
  milestone_id: string;
  position: number;
  title: string;
  amount: Money;
  state: string;
  due_date: string | null;
  auto_release_at: string | null;
  released_at: string | null;
  revision_count: number;
};
type Contract = {
  contract_id: string;
  title: string;
  status: string;
  client: { name: string; country: string };
  milestones: Milestone[];
};
type Card = Milestone & { contract: Contract };

const COLUMNS = ["AWAITING_FUNDING", "FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED", "ACCEPTED"] as const;
type Column = (typeof COLUMNS)[number];
const DAY = 86_400_000;

const TOP: Record<Column, string> = {
  AWAITING_FUNDING: "border-t-rule-strong",
  FUNDED: "border-t-gold-ink",
  IN_PROGRESS: "border-t-gold-ink",
  DELIVERED: "border-t-accent",
  REVISION_REQUESTED: "border-t-gold-ink",
  DISPUTED: "border-t-alert",
  ACCEPTED: "border-t-positive-ink",
};

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(id);
  }, []);
  return now;
}

function MilestoneCard({ c, now }: { c: Card; now: number | null }) {
  const { t, locale } = useI18n();
  const base = useBase();
  const due = c.due_date ? new Date(`${c.due_date}T23:59:59Z`).getTime() : null;
  const working = c.state === "FUNDED" || c.state === "IN_PROGRESS" || c.state === "REVISION_REQUESTED";
  const overdue = working && due !== null && now !== null && due < now;
  const soon = working && due !== null && now !== null && !overdue && due - now < 2 * DAY;
  return (
    <li className="relative rounded-md border border-rule bg-sheet p-3 shadow-[0_1px_0_var(--rule)] transition-colors focus-within:border-accent hover:border-accent/60">
      <p className="truncate text-xs text-ink-3">{c.contract.title}</p>
      <h3 className="mt-0.5 leading-snug font-semibold">
        <Link href={`${base}/projects/${c.contract.contract_id}`} className="after:absolute after:inset-0 hover:text-accent">
          {c.position}. {c.title}
        </Link>
      </h3>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
        <span className="truncate">{c.contract.client.name}</span>
        <CountryStamp country={c.contract.client.country} />
      </p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="num font-semibold">{c.amount.display}</span>
        {c.state === "ACCEPTED" ? (
          c.released_at && <span className="text-xs text-ink-3">{t("fl.proj.releasedOn", { date: dateText(c.released_at, locale) })}</span>
        ) : (
          c.due_date && (
            <span className={`text-xs ${overdue ? "font-semibold text-alert-ink" : soon ? "font-semibold text-gold-ink" : "text-ink-3"}`}>
              {overdue ? t("fl.proj.overdue", { date: dateText(c.due_date, locale) }) : t("fl.proj.due", { date: dateText(c.due_date, locale) })}
            </span>
          )
        )}
      </div>
      {c.state === "DELIVERED" && <AutoReleaseCountdown at={c.auto_release_at} className="mt-1.5 block text-xs" />}
      {c.state === "REVISION_REQUESTED" && c.revision_count > 0 && <p className="mt-1 text-xs text-ink-3">{t("fl.proj.revisions", { n: c.revision_count })}</p>}
    </li>
  );
}

/** Kanban of milestones by state. Read only: moving work forward happens on the project page. */
export function ProjectsBoard() {
  const { t } = useI18n();
  const now = useNow();
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<{ contracts: Contract[] }>("/api/contracts").then(
        (r) => {
          setContracts(r.contracts);
          setError(null);
        },
        (e: unknown) => setError(errText(e, t("fl.error"))),
      ),
    [t],
  );
  useEffect(() => {
    void load();
  }, [load]);
  usePageAssistant({ agent: "PROJECTS", onResult: () => void load() });

  const cards = new Map<Column, Card[]>(COLUMNS.map((c) => [c, []]));
  for (const c of contracts ?? []) {
    if (c.status === "CANCELLED") continue;
    for (const m of c.milestones) {
      if (!(COLUMNS as readonly string[]).includes(m.state)) continue;
      if (m.state === "ACCEPTED" && (now === null || !m.released_at || now - new Date(m.released_at).getTime() > 30 * DAY)) continue;
      cards.get(m.state as Column)!.push({ ...m, contract: c });
    }
  }
  for (const [col, list] of cards) {
    list.sort((a, b) =>
      col === "ACCEPTED" ? (b.released_at ?? "").localeCompare(a.released_at ?? "") : col === "DELIVERED" ? (a.auto_release_at ?? "").localeCompare(b.auto_release_at ?? "") : (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className={h1Cls}>{t("fl.nav.projects")}</h1>
        <p className="mt-1 text-ink-3">{t("fl.proj.intro")}</p>
      </header>
      {error && <Notice tone="error">{error}</Notice>}

      <div role="region" aria-label={t("fl.proj.board")} tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain rounded-[10px] pb-2 focus-visible:outline-2 focus-visible:outline-[var(--focus)]">
        <div className="flex w-max gap-3">
          {COLUMNS.map((col) => {
            const list = cards.get(col)!;
            const label = col === "ACCEPTED" ? t("fl.proj.accepted30") : milestoneStateLabel(t, col);
            return (
              <section key={col} aria-labelledby={`col-${col}`} className={`flex w-[17rem] shrink-0 flex-col rounded-[10px] border border-t-4 border-rule bg-sheet-2 ${TOP[col]}`}>
                <h2 id={`col-${col}`} className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 text-sm font-semibold">
                  <span>{label}</span>
                  <span className="num rounded-full bg-sheet px-2 py-0.5 text-xs text-ink-2">{contracts ? list.length : "–"}</span>
                </h2>
                {!contracts && !error ? (
                  <div className="m-3 h-24 animate-pulse rounded-md bg-sheet" aria-hidden />
                ) : list.length === 0 ? (
                  <p className="px-3 pb-3 text-sm text-ink-3">{t("fl.proj.empty")}</p>
                ) : (
                  <ul className="flex flex-col gap-2 px-2 pb-2">
                    {list.map((c) => (
                      <MilestoneCard key={c.milestone_id} c={c} now={now} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-ink-3">{t("fl.proj.holdingNote")}</p>

      <GigFindingsFeed agent="PROJECTS" />
    </div>
  );
}
