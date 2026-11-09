import Link from "next/link";
import { MarketRegionChart, SellerMonthlyChart } from "@/components/agcharts/Charts";
import { FeeAnatomy } from "@/components/charts";
import { FindingsFeed } from "@/components/findings/FindingsFeed";
import { IconArrowDown, IconArrowUp } from "@/components/icons";
import { PeriodPicker } from "@/components/PeriodPicker";
import { parseDashboardPeriod } from "@/lib/periods";
import { MarketStamp, Panel, ProductThumb, SectionHeading, Sparkline } from "@/components/ui";
import { formatBps, formatChange, formatCount, formatDay } from "@/lib/format";
import { getT, getUiLang } from "@/lib/i18n/server";
import { localeOf } from "@/lib/i18n/core";
import type { MessageKey } from "@/lib/i18n/messages";
import { sellerPath } from "@/lib/routes";
import { sellerPage } from "@/server/page-auth";
import { sellerOverview, sellerProductRows } from "@/server/services/analytics";
import { resolvePeriod } from "@/server/services/ledger";
import { listConversations } from "@/server/services/messages";

export const metadata = { title: "Overview" };

function Delta({ bps, invert = false, t }: { bps: number | null; invert?: boolean; t: Awaited<ReturnType<typeof getT>> }) {
  if (bps === null) return <span className="text-xs text-ink-3">{t("delta.none")}</span>;
  const good = invert ? bps < 0 : bps > 0;
  const Icon = bps >= 0 ? IconArrowUp : IconArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${bps === 0 ? "text-ink-3" : good ? "text-positive-ink" : "text-alert-ink"}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="num">{formatChange(bps)}</span>
      <span className="sr-only">{t("delta.vsPrev")}</span>
    </span>
  );
}

function Figure({ label, value, children, href }: { label: string; value: string; children?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="num mt-1 font-display text-[1.7rem] leading-tight font-semibold tracking-[-0.02em] text-ink [font-stretch:90%]">{value}</dd>
      <dd className="mt-0.5 min-h-5">{children}</dd>
    </>
  );
  return (
    <div className="bg-sheet px-4 py-3">
      {href ? (
        <Link href={href} className="block rounded-sm hover:text-accent">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

export default async function SellerOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const seller = await sellerPage();
  const base = sellerPath(seller.sellerId);
  const t = await getT();
  const uiLocale = localeOf(await getUiLang());
  const periodKey = parseDashboardPeriod((await searchParams).period);
  const period = resolvePeriod({ preset: periodKey });
  const [o, products, threads] = await Promise.all([
    sellerOverview(seller.sellerId, period),
    sellerProductRows(seller.sellerId, period),
    listConversations(seller),
  ]);
  const k = o.kpis;
  const topProducts = [...products.rows].sort((a, b) => b.net_home.amount_minor - a.net_home.amount_minor).slice(0, 5);
  const waiting = threads.filter((t) => t.unread > 0);
  const recentThreads = [...waiting, ...threads.filter((t) => t.unread === 0)].slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-3">
            {t("ov.sellingFrom")} <MarketStamp locale={o.seller.locale} showLanguage={false} /> {t("ov.inCurrency", { currency: o.seller.home_currency })}
          </p>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] text-ink md:text-[2.4rem]">{t("ov.title", { period: t(`ov.period.${periodKey}` as MessageKey) })}</h1>
        </div>
        <PeriodPicker current={periodKey} basePath={base} />
      </header>

      <FindingsFeed />

      <dl className="grid gap-px overflow-hidden rounded-[10px] border border-rule bg-rule cq-sm:grid-cols-2 cq-lg:grid-cols-5">
        <Figure label={t("kpi.net")} value={k.net.display}>
          <Delta bps={k.net_change_bps} t={t} />
        </Figure>
        <Figure label={t("kpi.orders")} value={formatCount(k.orders)}>
          <Delta bps={k.orders_change_bps} t={t} />
        </Figure>
        <Figure label={t("kpi.conversion")} value={formatBps(k.conversion_bps, 2)}>
          <span className="text-xs text-ink-3">{t("kpi.views", { n: formatCount(k.views) })}</span>
        </Figure>
        <Figure label={t("kpi.refunded")} value={formatBps(k.refund_rate_bps)}>
          {k.failed_payments > 0 ? <span className="text-xs text-ink-3">{k.failed_payments === 1 ? t("kpi.declinedOne") : t("kpi.declined", { n: k.failed_payments })}</span> : <span className="text-xs text-ink-3">{t("kpi.noDeclined")}</span>}
        </Figure>
        <Figure label={t("kpi.ready")} value={k.available.display} href={`${base}/treasury`}>
          <span className="text-xs text-accent">{t("kpi.openTreasury")}</span>
        </Figure>
      </dl>

      <FeeAnatomy data={o.fee_anatomy} periodLabel={t(`ov.period.${periodKey}` as MessageKey)} />

      <div className="grid gap-6 cq-lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel labelledBy="monthly-title">
          <SectionHeading id="monthly-title" title={t("monthly.title")} aside={t("monthly.aside", { currency: o.seller.home_currency })} />
          <SellerMonthlyChart months={o.monthly} currency={o.seller.home_currency} locale={o.seller.locale} title={t("monthly.title")} />
        </Panel>
        <Panel labelledBy="markets-title">
          <SectionHeading id="markets-title" title={t("markets.title")} aside={t("markets.count", { n: o.markets.length })} />
          <MarketRegionChart
            markets={o.markets}
            currency={o.seller.home_currency}
            locale={o.seller.locale}
            href={`${base}/ledger?tab=markets&period=${periodKey}`}
            title={t("markets.chart")}
          />
        </Panel>
      </div>

      <div className="grid gap-6 cq-xl:grid-cols-2">
        <Panel labelledBy="top-products">
          <SectionHeading id="top-products" title={t("best.title")} aside={<Link href={`${base}/ledger?tab=products`} className="text-accent hover:underline">{t("best.all")}</Link>} />
          <ul className="divide-y divide-rule">
            {topProducts.map((p) => (
              <li key={p.product_id} className="flex items-center gap-3 py-2.5">
                <ProductThumb src={p.image_url} alt="" size={40} />
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/products/${p.product_id}`} className="block truncate font-medium text-ink hover:text-accent">
                    {p.title}
                  </Link>
                  <p className="text-xs text-ink-3">
                    {t("best.sold", { n: p.units, m: p.markets.length })}
                  </p>
                </div>
                <span className="hidden cq-sm:block">
                  <Sparkline values={p.weekly_units} label={t("best.weekly", { title: p.title })} />
                </span>
                <span className="num shrink-0 text-right font-semibold text-ink cq-sm:w-24">{p.net_home.display}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel labelledBy="inbox-title">
          <SectionHeading
            id="inbox-title"
            title={waiting.length === 0 ? t("inbox.recent") : waiting.length === 1 ? t("inbox.waitingOne") : t("inbox.waiting", { n: waiting.length })}
            aside={<Link href={`${base}/messages`} className="text-accent hover:underline">{t("inbox.openMessages")}</Link>}
          />
          {recentThreads.length === 0 ? (
            <p className="text-sm text-ink-3">{t("inbox.none")}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {recentThreads.map((th) => (
                <li key={th.id}>
                  <Link href={`${base}/messages?c=${th.id}`} className="flex gap-3 py-2.5 hover:bg-sheet-2">
                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${th.unread > 0 ? "bg-alert" : "bg-transparent"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${th.unread > 0 ? "font-semibold text-ink" : "text-ink-2"}`}>
                          {th.counterpart.name}
                          {th.unread > 0 && <span className="sr-only">, unread</span>}
                        </span>
                        <span className="shrink-0 text-xs text-ink-3">{formatDay(th.last_message_at, uiLocale)}</span>
                      </span>
                      <span className="block truncate text-sm text-ink-3">{th.last_message?.preview}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="text-xs text-ink-3">{t("ov.footnote", { currency: o.seller.home_currency })}</p>
    </div>
  );
}
