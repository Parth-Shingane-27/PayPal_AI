import Link from "next/link";
import { AutoReleaseCountdown, MilestoneStamp } from "@/components/gig/MilestoneStamp";
import { Panel, SectionHeading } from "@/components/ui";
import { formatMonthYear } from "@/lib/format";
import { localeOf } from "@/lib/i18n/core";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT, getUiLang } from "@/lib/i18n/server";
import { clientPath } from "@/lib/routes";
import { getMarket } from "@/server/domain/markets";
import { clientPage } from "@/server/page-auth";
import { clientOverview } from "@/server/services/gig/dashboards";

export const metadata = { title: "Dashboard" };

/** Display order of the milestone states (kept here: a "use client" module's constants are not values on the server). */
const STATE_ORDER = ["AWAITING_FUNDING", "FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED", "ACCEPTED", "REFUNDED", "CANCELLED"];

export default async function ClientDashboard({ params }: { params: Promise<{ clientId: string }> }) {
  const client = await clientPage((await params).clientId);
  const base = clientPath(client.clientId);
  const t = await getT();
  const uiLocale = localeOf(await getUiLang());
  const market = getMarket(client.market);
  const o = await clientOverview(client.clientId, client.market);
  const states = STATE_ORDER.filter((s) => (o.milestones_by_state[s] ?? 0) > 0);
  const months = new Map<string, string[]>();
  for (const p of o.paid_by_month) {
    const key = p.month ?? "";
    months.set(key, [...(months.get(key) ?? []), p.amount.display]);
  }
  const monthRows = [...months.entries()].reverse();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-3">{t("cl.dash.hiringIn", { lang: t(`langname.${client.market.slice(0, 2)}` as MessageKey), currency: market.currency })}</p>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("cl.dash.title", { name: client.name.split(" ")[0] ?? client.name })}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/briefs`} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent">
            {t("cl.dash.writeBrief")}
          </Link>
          <Link href={`${base}/find`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-sheet">
            {t("cl.dash.find")}
          </Link>
        </div>
      </header>

      <section aria-labelledby="review-title" className="overflow-hidden rounded-[10px] border border-rule bg-accent-soft p-5 md:p-6">
        <h2 id="review-title" className="font-display text-xl font-semibold text-accent-ink">
          {t("cl.dash.review")}
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm text-accent-ink">{t("cl.dash.reviewIntro")}</p>
        {o.awaiting_your_review.length === 0 ? (
          <p className="mt-4 text-accent-ink">{t("cl.dash.reviewNone")}</p>
        ) : (
          <ul className="mt-4 grid gap-3 bq-md:grid-cols-2">
            {o.awaiting_your_review.map((m) => (
              <li key={m.milestone_id} className="flex flex-col gap-2 rounded-[8px] border border-rule bg-sheet p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{m.milestone}</p>
                    <p className="text-sm text-ink-3">{t("cl.dash.byFreelancer", { project: m.contract, name: m.freelancer })}</p>
                  </div>
                  <span className="num font-display text-lg font-semibold">{m.amount.display}</span>
                </div>
                <AutoReleaseCountdown at={m.auto_release_at} />
                <Link href={`${base}/projects/${m.contract_id}#ms-${m.milestone_id}`} className="inline-flex min-h-11 w-fit items-center rounded-md bg-accent px-4 text-sm font-semibold text-sheet">
                  {t("cl.dash.reviewCta")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 bq-lg:grid-cols-2">
        <Panel labelledBy="states-title">
          <SectionHeading id="states-title" title={t("cl.dash.byState")} aside={<Link href={`${base}/projects`} className="text-accent hover:underline">{t("cl.dash.allProjects")}</Link>} />
          {states.length === 0 ? (
            <p className="text-sm text-ink-3">{t("cl.dash.noMilestones")}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {states.map((s) => (
                <li key={s} className="flex items-center justify-between gap-3 py-2.5">
                  <MilestoneStamp state={s} />
                  <span className="num font-semibold">{o.milestones_by_state[s]}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel labelledBy="paid-title">
          <SectionHeading id="paid-title" title={t("cl.dash.paid")} aside={t("cl.dash.paidAside")} />
          {monthRows.length === 0 ? (
            <p className="text-sm text-ink-3">{t("cl.dash.paidNone")}</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t("cl.dash.paid")}</caption>
              <thead>
                <tr className="border-b border-rule-strong text-left text-xs text-ink-3">
                  <th scope="col" className="py-2 font-semibold">
                    {t("chart.month")}
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    {t("cl.dash.paidCol")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map(([month, amounts]) => (
                  <tr key={month} className="border-b border-rule align-top">
                    <th scope="row" className="py-2.5 text-left font-medium">
                      {formatMonthYear(month, uiLocale)}
                    </th>
                    <td className="num py-2.5 text-right">
                      {amounts.map((a) => (
                        <span key={a} className="block">
                          {a}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-ink-3">{t("cl.dash.paidNote")}</p>
        </Panel>
      </div>
    </div>
  );
}
