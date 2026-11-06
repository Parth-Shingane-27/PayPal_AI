import Link from "next/link";
import { MarketRegionChart, SellerMonthlyChart } from "@/components/agcharts/Charts";
import { FeeAnatomy } from "@/components/charts";
import { IconArrowDown, IconArrowUp } from "@/components/icons";
import { parseDashboardPeriod, PeriodPicker } from "@/components/PeriodPicker";
import { MarketStamp, Panel, ProductThumb, SectionHeading, Sparkline } from "@/components/ui";
import { formatBps, formatChange, formatCount, formatDay } from "@/lib/format";
import { sellerPage } from "@/server/page-auth";
import { sellerOverview, sellerProductRows } from "@/server/services/analytics";
import { resolvePeriod } from "@/server/services/ledger";
import { listConversations } from "@/server/services/messages";

export const metadata = { title: "Overview" };

function Delta({ bps, invert = false }: { bps: number | null; invert?: boolean }) {
  if (bps === null) return <span className="text-xs text-ink-3">no earlier period</span>;
  const good = invert ? bps < 0 : bps > 0;
  const Icon = bps >= 0 ? IconArrowUp : IconArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${bps === 0 ? "text-ink-3" : good ? "text-positive-ink" : "text-alert-ink"}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="num">{formatChange(bps)}</span>
      <span className="sr-only">compared with the previous period</span>
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
            Selling from <MarketStamp locale={o.seller.locale} showLanguage={false} /> in {o.seller.home_currency}
          </p>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] text-ink md:text-[2.4rem]">Your shop, {period.label.split(" (")[0]}</h1>
        </div>
        <PeriodPicker current={periodKey} basePath="/seller" />
      </header>

      <dl className="grid gap-px overflow-hidden rounded-[10px] border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-5">
        <Figure label="Net after fees and refunds" value={k.net.display}>
          <Delta bps={k.net_change_bps} />
        </Figure>
        <Figure label="Paid orders" value={formatCount(k.orders)}>
          <Delta bps={k.orders_change_bps} />
        </Figure>
        <Figure label="Visits that became orders" value={formatBps(k.conversion_bps, 2)}>
          <span className="text-xs text-ink-3">{formatCount(k.views)} listing views</span>
        </Figure>
        <Figure label="Orders refunded" value={formatBps(k.refund_rate_bps)}>
          {k.failed_payments > 0 ? <span className="text-xs text-ink-3">{k.failed_payments} {k.failed_payments === 1 ? "payment" : "payments"} declined</span> : <span className="text-xs text-ink-3">no declined payments</span>}
        </Figure>
        <Figure label="Ready to pay out" value={k.available.display} href="/seller/treasury">
          <span className="text-xs text-accent">Open Treasury</span>
        </Figure>
      </dl>

      <FeeAnatomy data={o.fee_anatomy} periodLabel={period.label.split(" (")[0] ?? period.label} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel labelledBy="monthly-title">
          <SectionHeading id="monthly-title" title="Where each month's sales went" aside={`${o.seller.home_currency}, last six months`} />
          <SellerMonthlyChart months={o.monthly} currency={o.seller.home_currency} locale={o.seller.locale} title="Where each month's sales went" />
        </Panel>
        <Panel labelledBy="markets-title">
          <SectionHeading id="markets-title" title="Where buyers are" aside={`${o.markets.length} markets`} />
          <MarketRegionChart
            markets={o.markets}
            currency={o.seller.home_currency}
            locale={o.seller.locale}
            href={`/seller/ledger?tab=markets&period=${periodKey}`}
            title="Net earnings by market"
          />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel labelledBy="top-products">
          <SectionHeading id="top-products" title="Best sellers" aside={<Link href="/seller/ledger?tab=products" className="text-accent hover:underline">All products</Link>} />
          <ul className="divide-y divide-rule">
            {topProducts.map((p) => (
              <li key={p.product_id} className="flex items-center gap-3 py-2.5">
                <ProductThumb src={p.image_url} alt="" size={40} />
                <div className="min-w-0 flex-1">
                  <Link href={`/seller/products/${p.product_id}`} className="block truncate font-medium text-ink hover:text-accent">
                    {p.title}
                  </Link>
                  <p className="text-xs text-ink-3">
                    {p.units} sold in {p.markets.length} markets
                  </p>
                </div>
                <span className="hidden sm:block">
                  <Sparkline values={p.weekly_units} label={`Weekly units, last 12 weeks, for ${p.title}`} />
                </span>
                <span className="num shrink-0 text-right font-semibold text-ink sm:w-24">{p.net_home.display}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel labelledBy="inbox-title">
          <SectionHeading
            id="inbox-title"
            title={waiting.length > 0 ? `${waiting.length} ${waiting.length === 1 ? "buyer is" : "buyers are"} waiting on you` : "Recent conversations"}
            aside={<Link href="/seller/messages" className="text-accent hover:underline">Open messages</Link>}
          />
          {recentThreads.length === 0 ? (
            <p className="text-sm text-ink-3">No conversations yet. Buyers can message you from any listing.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {recentThreads.map((t) => (
                <li key={t.id}>
                  <Link href={`/seller/messages?c=${t.id}`} className="flex gap-3 py-2.5 hover:bg-sheet-2">
                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${t.unread > 0 ? "bg-alert" : "bg-transparent"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${t.unread > 0 ? "font-semibold text-ink" : "text-ink-2"}`}>
                          {t.counterpart.name}
                          {t.unread > 0 && <span className="sr-only">, unread</span>}
                        </span>
                        <span className="shrink-0 text-xs text-ink-3">{formatDay(t.last_message_at)}</span>
                      </span>
                      <span className="block truncate text-sm text-ink-3">{t.last_message?.preview}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="text-xs text-ink-3">{o.reference_rates_note} Fees on seeded history are estimates from the fee table.</p>
    </div>
  );
}
