"use client";

/**
 * Milestone state as a stamp (same look as StatusStamp: shape + colour + words),
 * and the "releases automatically in …" countdown for delivered milestones.
 *
 *   <MilestoneStamp state="DELIVERED" />
 *   <AutoReleaseCountdown at={milestone.auto_release_at} />
 *
 * Holding states (FUNDED, IN_PROGRESS, DELIVERED, REVISION_REQUESTED, DISPUTED)
 * say "in holding"; ACCEPTED reads as released; DISPUTED as an alert.
 */
import { useEffect, useState } from "react";
import type { Translate } from "@/lib/i18n/core";
import type { MessageKey } from "@/lib/i18n/messages";
import { useI18n, useT } from "../i18n/I18nProvider";

export const MILESTONE_STATES = [
  "AWAITING_FUNDING",
  "FUNDED",
  "IN_PROGRESS",
  "DELIVERED",
  "REVISION_REQUESTED",
  "ACCEPTED",
  "DISPUTED",
  "REFUNDED",
  "CANCELLED",
] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

const HOLDING = new Set<string>(["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"]);

/** Money for this milestone is captured and held, not yet released to the freelancer. */
export const isHoldingState = (state: string): boolean => HOLDING.has(state);

/** The stamp's words, e.g. for grid quick-filter text or CSV. Unknown states come back as-is. */
export function milestoneStateLabel(t: Translate, state: string): string {
  return (MILESTONE_STATES as readonly string[]).includes(state) ? t(`shared.ms.${state}` as MessageKey) : state;
}

const holdingMark = (
  <>
    <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <rect x="3.5" y="3.5" width="3" height="3" fill="currentColor" />
  </>
);

const STYLE: Record<MilestoneState, { cls: string; mark: React.ReactNode }> = {
  AWAITING_FUNDING: { cls: "text-ink-2 bg-sheet-2", mark: <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.4" /> },
  FUNDED: { cls: "text-gold-ink bg-gold-soft", mark: holdingMark },
  IN_PROGRESS: { cls: "text-gold-ink bg-gold-soft", mark: holdingMark },
  DELIVERED: { cls: "text-gold-ink bg-gold-soft", mark: holdingMark },
  REVISION_REQUESTED: { cls: "text-gold-ink bg-gold-soft", mark: holdingMark },
  ACCEPTED: { cls: "text-positive-ink bg-positive-soft", mark: <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" /> },
  DISPUTED: {
    cls: "text-alert-ink bg-alert-soft",
    mark: (
      <>
        <path d="M5 1 9.2 8.6H.8z" fill="currentColor" />
      </>
    ),
  },
  REFUNDED: { cls: "text-alert-ink bg-alert-soft", mark: <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /> },
  CANCELLED: { cls: "text-ink-3 bg-sheet-2", mark: <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> },
};

/** One milestone's state. `state` is the API's MilestoneState string. */
export function MilestoneStamp({ state }: { state: MilestoneState | string }) {
  const t = useT();
  const s = STYLE[state as MilestoneState] ?? { cls: "text-ink-2 bg-sheet-2", mark: <circle cx="5" cy="5" r="3.5" fill="currentColor" /> };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-semibold ${s.cls}`}
      title={isHoldingState(state) ? t("shared.ms.holdingTip") : undefined}
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
        {s.mark}
      </svg>
      {milestoneStateLabel(t, state)}
    </span>
  );
}

function useMinuteClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  return now;
}

/** "{n} days {h} h" in the viewer's language. */
function durationText(t: Translate, ms: number): string {
  const hoursTotal = Math.floor(ms / 3_600_000);
  const d = Math.floor(hoursTotal / 24);
  const h = hoursTotal % 24;
  const days = d === 1 ? t("shared.dur.day") : t("shared.dur.days", { n: d });
  const hours = t("shared.dur.hours", { n: h });
  return h === 0 ? days : `${days} ${hours}`;
}

/**
 * "Releases automatically in 2 days 4 h", or "… today" within the last 24 hours
 * (and once the time has passed, until the release job runs). Updates every minute.
 * `at` is the milestone's auto_release_at ISO string; renders nothing when null.
 */
export function AutoReleaseCountdown({ at, className = "" }: { at: string | null | undefined; className?: string }) {
  const { t, locale } = useI18n();
  const now = useMinuteClock();
  if (!at || now === null) return null;
  const left = new Date(at).getTime() - now;
  const exact = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
  return (
    <span className={`text-sm text-ink-2 ${className}`} title={exact}>
      {left < 86_400_000 ? t("shared.release.today") : t("shared.release.in", { time: durationText(t, left) })}
    </span>
  );
}
