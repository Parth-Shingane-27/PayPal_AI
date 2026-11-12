import Link from "next/link";
import { AutoReleaseCountdown } from "@/components/gig/MilestoneStamp";
import { Panel, SectionHeading } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { clientPath } from "@/lib/routes";
import { clientPage } from "@/server/page-auth";
import { clientHome } from "@/server/services/gig/dashboards";

export const metadata = { title: "Dashboard" };

const primary = "inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-sheet";
const action = "inline-flex min-h-11 shrink-0 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent";

/** One screen: everything that needs the client's decision in one list, then active projects and money. */
export default async function ClientDashboard({ params }: { params: Promise<{ clientId: string }> }) {
  const client = await clientPage((await params).clientId);
  const base = clientPath(client.clientId);
  const t = await getT();
  const o = await clientHome(client.clientId, client.market);
  const d = o.needs_decision;
  const nothing = d.proposals.length + d.deliveries.length + d.plans_to_fund.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("pj.cd.hello", { name: client.name.split(" ")[0] ?? client.name })}</h1>
        <Link href={`${base}/briefs?new=1`} className={primary}>
          {t("pj.cd.post")}
        </Link>
      </header>

      <section aria-labelledby="decide-title" className="rounded-[10px] border border-rule bg-accent-soft p-5 md:p-6">
        <h2 id="decide-title" className="font-display text-xl font-semibold text-accent-ink">
          {t("pj.cd.decide")}
        </h2>
        {nothing ? (
          <p className="mt-2 max-w-[60ch] text-accent-ink">{t("pj.cd.decideNone")}</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-rule-strong/50">
            {d.proposals.map((p) => (
              <li key={p.brief_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="min-w-0 font-medium">{p.proposals === 1 ? t("pj.cd.proposalsOne", { title: p.title }) : t("pj.cd.proposalsN", { n: p.proposals, title: p.title })}</p>
                <Link href={`${base}/briefs?open=${p.brief_id}`} className={action}>
                  {t("pj.cd.compare")}
                </Link>
              </li>
            ))}
            {d.deliveries.map((m) => (
              <li key={m.milestone_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{t("pj.cd.delivered", { freelancer: m.freelancer, milestone: m.milestone, contract: m.contract })}</p>
                  <p className="num text-sm text-ink-2">
                    {m.amount.display}
                    {m.auto_release_at && (
                      <>
                        {" · "}
                        <AutoReleaseCountdown at={m.auto_release_at} />
                      </>
                    )}
                  </p>
                </div>
                <Link href={`${base}/projects/${m.contract_id}`} className={action}>
                  {t("pj.cd.review")}
                </Link>
              </li>
            ))}
            {d.plans_to_fund.map((c) => (
              <li key={c.contract_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="min-w-0 font-medium">{t("pj.cd.fund", { title: c.title, total: c.total.display })}</p>
                <Link href={`${base}/projects/${c.contract_id}`} className={action}>
                  {t("pj.cd.fundCta")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 bq-lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel labelledBy="active-title">
          <SectionHeading id="active-title" title={t("pj.cd.active")} aside={<Link href={`${base}/projects`} className="text-accent hover:underline">{t("cl.dash.allProjects")}</Link>} />
          {o.active.length === 0 ? (
            <p className="text-ink-3">{t("pj.cd.activeNone")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule">
              {o.active.map((c) => (
                <li key={c.contract_id}>
                  <Link href={`${base}/projects/${c.contract_id}`} className="block min-h-11 py-3 hover:text-accent">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="block text-sm text-ink-3">
                      {c.freelancer} · {t("pj.cd.progress", { done: c.done, total: c.total })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel labelledBy="money-title">
          <SectionHeading id="money-title" title={t("pj.cd.money")} aside={<Link href={`${base}/invoices`} className="text-accent hover:underline">{t("cl.nav.invoices")}</Link>} />
          <dl className="flex flex-col gap-4">
            <div>
              <dt className="text-sm text-ink-3">{t("pj.cd.paid")}</dt>
              <dd className="num font-display text-[1.5rem] leading-tight font-semibold [font-stretch:90%]">{o.paid.length ? o.paid.map((m) => m.display).join(" · ") : t("pj.cd.none")}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-3">{t("pj.cd.owed")}</dt>
              <dd className="num font-display text-[1.5rem] leading-tight font-semibold [font-stretch:90%]">{o.owed.length ? o.owed.map((m) => m.display).join(" · ") : t("pj.cd.none")}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-3">{t("cl.dash.paidNote")}</p>
        </Panel>
      </div>
    </div>
  );
}
