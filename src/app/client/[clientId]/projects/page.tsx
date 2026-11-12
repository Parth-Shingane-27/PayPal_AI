import Link from "next/link";
import { CountryStamp } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { localeOf } from "@/lib/i18n/core";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT, getUiLang } from "@/lib/i18n/server";
import { clientPath } from "@/lib/routes";
import { gigOwnerOf } from "@/server/auth";
import { clientPage } from "@/server/page-auth";
import { listContracts } from "@/server/services/gig/contracts";

export const metadata = { title: "Projects" };

const GROUPS: { status: string; title: MessageKey; empty: MessageKey }[] = [
  { status: "DRAFT", title: "cl.proj.group.DRAFT", empty: "cl.proj.empty.DRAFT" },
  { status: "ACTIVE", title: "cl.proj.group.ACTIVE", empty: "cl.proj.empty.ACTIVE" },
  { status: "COMPLETED", title: "cl.proj.group.COMPLETED", empty: "cl.proj.empty.COMPLETED" },
];

export default async function ProjectsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const client = await clientPage((await params).clientId);
  const base = clientPath(client.clientId);
  const t = await getT();
  const uiLocale = localeOf(await getUiLang());
  const contracts = await listContracts(gigOwnerOf(client), { limit: 200 });
  const cancelled = contracts.filter((c) => c.status === "CANCELLED");

  const card = (c: (typeof contracts)[number]) => {
    const live = c.milestones.filter((m) => m.state !== "CANCELLED");
    const accepted = live.filter((m) => m.state === "ACCEPTED").length;
    const next = c.milestones.find((m) => m.state === "AWAITING_FUNDING");
    const delivered = c.milestones.filter((m) => m.state === "DELIVERED").length;
    return (
      <li key={c.contract_id}>
        <Link href={`${base}/projects/${c.contract_id}`} className="flex h-full flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 transition-colors hover:border-accent/70">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-lg leading-snug font-semibold">{c.title}</h3>
              <p className="mt-1 flex items-center gap-2 text-sm text-ink-3">
                <CountryStamp country={c.freelancer.country} />
                <span className="truncate">{c.freelancer.name}</span>
                <span>·</span>
                <span>{formatDate(c.created_at, uiLocale)}</span>
              </p>
            </div>
            <span className="num font-display text-xl font-semibold whitespace-nowrap">{c.total.display}</span>
          </div>
          <div>
            <p className="flex justify-between text-sm">
              <span className="text-ink-2">{t("cl.proj.progress", { done: accepted, total: live.length })}</span>
            </p>
            <div
              className="mt-1 h-2 w-full overflow-hidden rounded-full bg-sheet-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={live.length}
              aria-valuenow={accepted}
              aria-label={t("cl.proj.progress", { done: accepted, total: live.length })}
            >
              <div className="h-full rounded-full bg-positive" style={{ width: `${live.length ? Math.round((accepted * 100) / live.length) : 0}%` }} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-ink-3">{t("shared.led.col.inHolding")}</dt>
              <dd className="num font-semibold">{c.in_holding.display}</dd>
            </div>
            <div>
              <dt className="text-ink-3">{t("cl.proj.released")}</dt>
              <dd className="num font-semibold">{c.released.display}</dd>
            </div>
          </dl>
          {delivered > 0 && <p className="rounded-md bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-ink">{t("cl.proj.toReview", { n: delivered })}</p>}
          {next && c.status !== "COMPLETED" && (
            <p className="text-sm text-ink-2">{t("cl.proj.nextToFund", { n: next.position, amount: next.amount.display })}</p>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("cl.proj.pageTitle")}</h1>
          <p className="mt-1 max-w-[65ch] text-ink-3">{t("cl.proj.intro")}</p>
        </div>
        <Link href={`${base}/briefs`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-sheet">
          {t("cl.dash.find")}
        </Link>
      </header>

      {GROUPS.map((g) => {
        const rows = contracts.filter((c) => c.status === g.status);
        return (
          <section key={g.status} aria-labelledby={`p-${g.status}`}>
            <h2 id={`p-${g.status}`} className="font-display mb-3 text-xl font-semibold">
              {t(g.title)} <span className="num text-base font-normal text-ink-3">({rows.length})</span>
            </h2>
            {rows.length === 0 ? <p className="text-sm text-ink-3">{t(g.empty)}</p> : <ul className="grid gap-4 bq-md:grid-cols-2 bq-xl:grid-cols-3">{rows.map(card)}</ul>}
          </section>
        );
      })}

      {cancelled.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-ink-2">
            {t("cl.proj.group.CANCELLED")} ({cancelled.length})
          </summary>
          <ul className="mt-2 grid gap-4 bq-md:grid-cols-2 bq-xl:grid-cols-3">{cancelled.map(card)}</ul>
        </details>
      )}
    </div>
  );
}
