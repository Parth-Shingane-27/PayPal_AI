"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MilestoneCaptureOutcome } from "@/components/PayPalButtons";
import { useGigBase } from "@/components/gig/use-gig-base";

type Outcome = { tone: "ok" | "wait" | "bad"; text: string; contractId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Captures the approved PayPal order exactly once and says where the money is now. */
export function CheckoutReturn({ token, milestoneId, cancelled }: { token: string | null; milestoneId: string | null; cancelled: boolean }) {
  const { t } = useI18n();
  const base = useGigBase();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const projectOf = async (): Promise<string | null> => {
      if (!milestoneId || !UUID.test(milestoneId)) return null;
      try {
        return (await api<{ contract_id: string }>(`/api/milestones/${milestoneId}`)).contract_id;
      } catch {
        return null;
      }
    };
    if (cancelled || !token) {
      void projectOf().then((contractId) => setOutcome({ tone: cancelled ? "wait" : "bad", text: cancelled ? t("cl.fund.cancelled") : t("cl.ret.missing"), contractId }));
      return;
    }
    api<MilestoneCaptureOutcome>("/api/milestone-checkout/capture", { body: { paypal_order_id: token } })
      .then((o) =>
        setOutcome({
          tone: o.payment_status === "COMPLETED" ? "ok" : o.payment_status === "PENDING" ? "wait" : "bad",
          text:
            o.payment_status === "COMPLETED"
              ? t("cl.ret.ok", { amount: o.amount.display })
              : o.payment_status === "PENDING"
                ? t("cl.ret.pending", { amount: o.amount.display })
                : t("cl.ret.failed", { status: o.payment_status }),
          contractId: o.contract_id,
        }),
      )
      .catch(async (err: unknown) => setOutcome({ tone: "bad", text: err instanceof Error ? err.message : t("cl.err.generic"), contractId: await projectOf() }));
  }, [token, milestoneId, cancelled, t]);

  const style = { ok: "bg-positive-soft text-positive-ink", wait: "bg-gold-soft text-gold-ink", bad: "bg-alert-soft text-alert-ink" };
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("cl.ret.title")}</h1>
      {outcome === null ? (
        <p role="status" className="rounded-md bg-sheet-2 px-4 py-3 text-ink-2">
          {t("cl.ret.confirming")}
        </p>
      ) : (
        <p role={outcome.tone === "bad" ? "alert" : "status"} className={`rounded-md px-4 py-3 ${style[outcome.tone]}`}>
          {outcome.text}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {outcome?.contractId && (
          <Link href={`${base}/projects/${outcome.contractId}`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-sheet">
            {t("cl.ret.toProject")}
          </Link>
        )}
        <Link href={`${base}/projects`} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent">
          {t("cl.ret.allProjects")}
        </Link>
      </div>
    </div>
  );
}
