import Link from "next/link";
import { GigFindingsFeed } from "@/components/gig/GigFindingsFeed";
import { ReleasedByMonthChart } from "@/components/gig/freelancer/ReleasedByMonthChart";
import { Panel, SectionHeading } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { freelancerPath } from "@/lib/routes";
import { freelancerPage } from "@/server/page-auth";
import { freelancerOverview } from "@/server/services/gig/dashboards";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("nav.overview") };
}

function Figure({ label, value, children, href }: { label: string; value: string; children?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="num mt-1 font-display text-[1.7rem] leading-tight font-semibold tracking-[-0.02em] text-ink [font-stretch:90%]">{value}</dd>
      <dd className="mt-0.5 min-h-5 text-xs text-ink-3">{children}</dd>
    </>
  );
  return (
    <div className="bg-sheet px-4 py-3">
      {href ? (
        <Link href={href} className="block min-h-11 rounded-sm hover:text-accent">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

export default async function FreelancerOverview({ params }: { params: Promise<{ freelancerId: string }> }) {
  const { freelancerId } = await params;
  const f = await freelancerPage(freelancerId);
  const base = freelancerPath(f.freelancerId);
  const t = await getT();
  const o = await freelancerOverview(f.freelancerId);
  const totals = o.totals_at_reference_rates;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-ink-3">{t("fl.ov.eyebrow", { currency: o.home_currency })}</p>
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] text-ink md:text-[2.4rem]">{t("fl.ov.title", { name: f.name.split(" ")[0] ?? f.name })}</h1>
      </header>

      <dl className="grid gap-px overflow-hidden rounded-[10px] border border-rule bg-rule cq-sm:grid-cols-2 cq-lg:grid-cols-4">
        <Figure label={t("fl.ov.available")} value={totals.available.display} href={`${base}/earnings`}>
          {t("fl.ov.atReference", { currency: o.home_currency })}
        </Figure>
        <Figure label={t("fl.ov.inHolding")} value={totals.in_holding.display} href={`${base}/earnings`}>
          {t("fl.ov.atReference", { currency: o.home_currency })}
        </Figure>
        <Figure label={t("fl.ov.active")} value={String(o.active_milestones)} href={`${base}/projects`}>
          {o.due_within_48h > 0 ? <span className="font-semibold text-alert-ink">{t("fl.ov.dueSoon", { n: o.due_within_48h })}</span> : t("fl.ov.nothingDue")}
        </Figure>
        <Figure label={t("fl.ov.quotes")} value={String(o.quote_requests_waiting)} href={`${base}/quotes`}>
          {o.quote_requests_waiting > 0 ? t("fl.ov.quotesHint") : t("fl.ov.quotesNone")}
        </Figure>
      </dl>

      <GigFindingsFeed />

      <div className="grid gap-6 cq-lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Panel labelledBy="balances-title">
          <SectionHeading id="balances-title" title={t("fl.ov.byCurrency")} aside={<Link href={`${base}/earnings`} className="text-accent hover:underline">{t("fl.ov.openEarnings")}</Link>} />
          {o.balances.length === 0 ? (
            <p className="text-sm text-ink-3">{t("fl.earn.none")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs text-ink-3">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("col.currency")}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    {t("fl.ov.available")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("fl.ov.inHolding")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.balances.map((b) => (
                  <tr key={b.currency} className="border-b border-rule last:border-0">
                    <th scope="row" className="py-2.5 pr-3 text-left font-semibold">
                      {b.currency}
                    </th>
                    <td className="num py-2.5 pr-3 text-right font-semibold">{b.available.display}</td>
                    <td className="num py-2.5 text-right text-ink-2">{b.in_holding.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-ink-3">{t("fl.earn.holdingExplain")}</p>
        </Panel>
        <Panel labelledBy="released-title">
          <SectionHeading id="released-title" title={t("fl.ov.releasedTitle")} aside={t("fl.ov.atReference", { currency: o.home_currency })} />
          <ReleasedByMonthChart months={o.released_by_month} currency={o.home_currency} title={t("fl.ov.releasedTitle")} />
        </Panel>
      </div>
      <p className="text-xs text-ink-3">{t("fl.ov.footnote")}</p>
    </div>
  );
}
