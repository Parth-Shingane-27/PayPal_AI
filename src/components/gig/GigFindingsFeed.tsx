"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { openAssistant } from "@/components/assistant/AssistantContext";
import { api, ApiError } from "@/components/api";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Markdown } from "@/components/Markdown";
import type { MessageKey } from "@/lib/i18n/messages";
import { useGigBase } from "./use-gig-base";

export type GigFindingAgent = "PROFILE";
type Finding = {
  id: string;
  agent: GigFindingAgent;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  body: string;
  status: string;
  session_id: string | null;
  action_id: string | null;
  last_seen_at: string;
};

const BAR: Record<Finding["severity"], string> = { HIGH: "bg-alert", MEDIUM: "bg-accent", LOW: "bg-rule-strong" };
const CHIP: Record<Finding["severity"], string> = { HIGH: "bg-alert-soft text-alert-ink", MEDIUM: "bg-gold-soft text-gold-ink", LOW: "bg-sheet-2 text-ink-2" };
const action =
  "inline-flex min-h-10 cursor-pointer items-center rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Freelancer only. What the Freelancer Agent found on its own checks (GET /api/freelancer/findings), most severe first. Each card can be
 * discussed (opens the assistant panel on that agent, resuming its
 * conversation), snoozed for 7 days or dismissed; "Check now" queues a check.
 * A finding with a drafted action links to `${base}/approvals`. Nothing here moves money.
 *
 *   <GigFindingsFeed />
 */
export function GigFindingsFeed() {
  const { t } = useI18n();
  const base = useGigBase();
  const [items, setItems] = useState<Finding[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState<"idle" | "busy" | "started" | "off">("idle");

  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    api<{ findings: Finding[] }>("/api/freelancer/findings")
      .then((r) => {
        if (!alive) return;
        setItems(r.findings);
        setFailed(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setItems((cur) => cur ?? []);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  // Anything the freelancer has now been shown stops counting as new.
  useEffect(() => {
    const fresh = (items ?? []).filter((f) => f.status === "NEW");
    if (fresh.length === 0) return;
    const id = window.setTimeout(() => {
      for (const f of fresh) void api(`/api/freelancer/findings/${f.id}`, { body: { action: "seen" } }).catch(() => undefined);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [items]);

  async function act(f: Finding, body: { action: "dismiss" } | { action: "snooze"; days: number }) {
    setItems((cur) => (cur ?? []).filter((x) => x.id !== f.id));
    try {
      await api(`/api/freelancer/findings/${f.id}`, { body });
    } catch {
      reload();
    }
  }

  async function checkNow() {
    setChecking("busy");
    try {
      await api("/api/freelancer/proactive-check", { body: {} });
      setChecking("started");
      window.setTimeout(reload, 15_000);
      window.setTimeout(() => setChecking("idle"), 20_000);
    } catch (e) {
      // 409: automatic checks are switched off on this server.
      setChecking(e instanceof ApiError && e.code === "CONFLICT" ? "off" : "idle");
    }
  }

  // Opens the assistant panel on the agent that wrote the finding, resuming that conversation. Works from any page.
  function discuss(f: Finding) {
    if (f.session_id) openAssistant({ agent: f.agent, sessionId: f.session_id });
  }

  if (items === null) return null;

  return (
    <section aria-labelledby="gig-findings-title" className="rounded-[10px] border border-rule bg-sheet">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-rule-strong px-4 py-3 md:px-5">
        <div className="min-w-0">
          <h2 id="gig-findings-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
            {t("find.title")}
          </h2>
          <p className="text-sm text-ink-3">{t("shared.find.sub")}</p>
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={checking === "busy" || checking === "started"}
          className={`${action} border border-rule-strong text-ink-2 hover:bg-sheet-2 hover:text-ink`}
        >
          {checking === "busy" ? t("find.checking") : t("find.checkNow")}
        </button>
      </header>

      {checking === "started" && (
        <p role="status" className="border-b border-rule bg-sheet-2 px-4 py-2 text-sm text-ink-2 md:px-5">
          {t("find.started")}
        </p>
      )}
      {checking === "off" && (
        <p role="status" className="border-b border-rule bg-sheet-2 px-4 py-2 text-sm text-ink-2 md:px-5">
          {t("shared.find.off")}
        </p>
      )}
      {failed && (
        <p role="alert" className="px-4 py-3 text-sm text-alert-ink md:px-5">
          {t("find.error")}
        </p>
      )}
      {!failed && items.length === 0 && <p className="px-4 py-4 text-sm text-ink-3 md:px-5">{t("find.empty")}</p>}

      <ul className="divide-y divide-rule">
        {items.map((f) => (
          <li key={f.id} className="relative flex gap-3 px-4 py-4 pl-5 md:px-5 md:pl-6">
            <span className={`absolute inset-y-3 left-0 w-1 rounded-r ${BAR[f.severity] ?? BAR.LOW}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-[3px] px-2 py-0.5 font-semibold ${CHIP[f.severity] ?? CHIP.LOW}`}>{t(`find.sev.${f.severity}` as MessageKey)}</span>
                {f.status === "NEW" && <span className="rounded-[3px] bg-ink px-2 py-0.5 font-semibold text-sheet">{t("find.new")}</span>}
              </div>
              <h3 className="mt-1.5 leading-snug font-semibold text-ink">{f.title}</h3>
              <Markdown text={f.body} className="mt-1 max-w-[70ch] text-[0.95rem] text-ink-2" />
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {f.action_id && (
                  <Link href={`${base}/approvals`} className={`${action} bg-accent text-sheet hover:brightness-95`}>
                    {t("find.review")}
                  </Link>
                )}
                {f.session_id && (
                  <button type="button" onClick={() => discuss(f)} className={`${action} border border-rule-strong text-ink-2 hover:bg-sheet-2 hover:text-ink`}>
                    {t("find.discuss")}
                  </button>
                )}
                <button type="button" onClick={() => void act(f, { action: "snooze", days: 7 })} className={`${action} text-ink-3 hover:bg-sheet-2 hover:text-ink`}>
                  {t("find.snooze")}
                </button>
                <button type="button" onClick={() => void act(f, { action: "dismiss" })} className={`${action} text-ink-3 hover:bg-sheet-2 hover:text-ink`}>
                  {t("find.dismiss")}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
