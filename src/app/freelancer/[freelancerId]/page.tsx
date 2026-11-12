import Link from "next/link";
import { GigFindingsFeed } from "@/components/gig/GigFindingsFeed";
import { MilestoneStamp } from "@/components/gig/MilestoneStamp";
import { Panel, SectionHeading } from "@/components/ui";
import { localeOf } from "@/lib/i18n/core";
import { getT, getUiLang } from "@/lib/i18n/server";
import { freelancerPath } from "@/lib/routes";
import { freelancerPage } from "@/server/page-auth";
import { freelancerHome } from "@/server/services/gig/dashboards";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("nav.overview") };
}

const primary = "inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-sheet";
const secondary = "inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent";

/** One screen, four blocks: money, what is due next, proposals, and projects that match. */
export default async function FreelancerHome({ params }: { params: Promise<{ freelancerId: string }> }) {
  const { freelancerId } = await params;
  const f = await freelancerPage(freelancerId);
  const base = freelancerPath(f.freelancerId);
  const t = await getT();
  const uiLocale = localeOf(await getUiLang());
  const h = await freelancerHome(f.freelancerId);
  const totals = h.totals_at_reference_rates;
  const date = (iso: string) => new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const matches = h.new_matching_projects;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] text-ink md:text-[2.4rem]">{t("pj.fd.hello", { name: f.name.split(" ")[0] ?? f.name })}</h1>
        <Link href={`${base}/board`} className={primary}>
          {t("pj.fd.browse")}
        </Link>
      </header>

      <div className="grid gap-4 cq-xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel labelledBy="money-title">
          <SectionHeading id="money-title" title={t("pj.fd.money")} />
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-ink-3">{t("fl.ov.available")}</dt>
              <dd className="num mt-1 font-display text-[1.7rem] leading-tight font-semibold tracking-[-0.02em] [font-stretch:90%]">{totals.available.display}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-3">{t("fl.ov.inHolding")}</dt>
              <dd className="num mt-1 font-display text-[1.7rem] leading-tight font-semibold tracking-[-0.02em] [font-stretch:90%]">{totals.in_holding.display}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-ink-3">{t("fl.ov.atReference", { currency: h.home_currency })}</p>
          <p className="mt-3 text-sm text-ink-2">{t("pj.fd.holdNote")}</p>
          <div className="mt-4">
            <Link href={`${base}/earnings`} className={h.can_request_payout ? primary : secondary}>
              {t("pj.fd.payout")}
            </Link>
          </div>
        </Panel>

        <Panel labelledBy="next-title">
          <SectionHeading id="next-title" title={t("pj.fd.nextUp")} aside={<Link href={`${base}/projects`} className="text-accent hover:underline">{t("cl.dash.allProjects")}</Link>} />
          {h.next_up.length === 0 ? (
            <p className="text-ink-3">{t("pj.fd.nextNone")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule">
              {h.next_up.map((m) => (
                <li key={m.milestone_id}>
                  <Link href={`${base}/projects/${m.contract_id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 hover:text-accent">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.contract}</span>
                      <span className="block truncate text-sm text-ink-3">
                        {m.milestone} · {m.client}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-sm">
                      <MilestoneStamp state={m.state} />
                      <span className="num text-ink-2">{m.due_date ? t("pj.fd.due", { date: date(m.due_date) }) : t("pj.fd.noDate")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 cq-lg:grid-cols-2">
        <Panel labelledBy="proposals-title">
          <SectionHeading id="proposals-title" title={t("pj.fd.proposals")} aside={<Link href={`${base}/board?tab=mine`} className="text-accent hover:underline">{t("pj.fd.open")}</Link>} />
          <ul className="flex flex-col gap-1 text-ink-2">
            <li>{t("pj.fd.waiting", { n: h.proposals_waiting })}</li>
            <li>{t("pj.fd.won", { n: h.proposals_won_this_month })}</li>
          </ul>
        </Panel>
        <Panel labelledBy="matches-title">
          <SectionHeading id="matches-title" title={t("pj.fd.matches")} aside={<Link href={`${base}/board`} className="text-accent hover:underline">{t("pj.fd.open")}</Link>} />
          <p className="text-ink-2">{matches === 0 ? t("pj.fd.matchesNone") : matches === 1 ? t("pj.fd.matchesOne") : t("pj.fd.matchesN", { n: matches })}</p>
        </Panel>
      </div>

      <GigFindingsFeed />
    </div>
  );
}
