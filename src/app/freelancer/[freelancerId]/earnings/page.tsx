import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { freelancerPath } from "@/lib/routes";
import { parseDashboardPeriod } from "@/lib/periods";
import { prisma } from "@/server/db";
import { freelancerPage } from "@/server/page-auth";
import { EarningsView } from "./EarningsView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("fl.nav.earnings") };
}

export default async function EarningsPage({
  params,
  searchParams,
}: {
  params: Promise<{ freelancerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { freelancerId } = await params;
  const f = await freelancerPage(freelancerId);
  const sp = await searchParams;
  const t = await getT();
  // The settings route only writes; the toggle's current value comes from the freelancer row.
  const settings = await prisma.freelancer.findUnique({ where: { id: f.freelancerId }, select: { auto_payout_proposals: true } });
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("fl.nav.earnings")}</h1>
          <p className="mt-1 text-ink-3">{t("fl.earn.intro")}</p>
        </div>
        <nav aria-label={t("fl.nav.earnings")} className="flex flex-wrap gap-2">
          <Link href={freelancerPath(f.freelancerId, "invoices")} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent">
            {t("fl.nav.invoices")}
          </Link>
          <Link href={freelancerPath(f.freelancerId, "approvals")} className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent">
            {t("nav.approvals")}
          </Link>
        </nav>
      </header>
      <EarningsView period={parseDashboardPeriod(sp.period)} tab={typeof sp.tab === "string" ? sp.tab : undefined} autoProposals={settings?.auto_payout_proposals ?? false} />
    </div>
  );
}
