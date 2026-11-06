import Link from "next/link";
import { PurchasesGrid } from "@/components/buyer/PurchasesGrid";
import { BuyerSpendChart } from "@/components/agcharts/Charts";
import { Panel, ProductThumb, SectionHeading } from "@/components/ui";
import { formatBps, formatDate, formatDay } from "@/lib/format";
import { localeOf } from "@/lib/i18n/core";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT, getUiLang } from "@/lib/i18n/server";
import { buyerPage } from "@/server/page-auth";
import { buyerOverview } from "@/server/services/analytics";
import { listConversations } from "@/server/services/messages";

export const metadata = { title: "Journal" };

/** A postage stamp for one maker's country: perforated edge, country code, count. */
function PassportStamp({ country, makers, orders, rotate, t }: { country: string; makers: string[]; orders: number; rotate: number; t: Awaited<ReturnType<typeof getT>> }) {
  return (
    <li
      className="relative flex aspect-[4/5] w-28 flex-col justify-between bg-sheet p-2.5 text-ink outline outline-[1.5px] outline-offset-[-6px] outline-dashed outline-rule-strong transition-transform duration-200 [transform:rotate(var(--tilt))] hover:[transform:rotate(0deg)_translateY(-4px)] hover:shadow-[var(--shadow-overlay)]"
      style={{ "--tilt": `${rotate}deg` } as React.CSSProperties}
    >
      <span className="perforated absolute inset-x-0 -top-[3px] h-[7px]" aria-hidden />
      <span className="perforated absolute inset-x-0 -bottom-[3px] h-[7px]" aria-hidden />
      <span className="font-display text-[2.1rem] leading-none font-bold tracking-tight text-accent [font-stretch:80%]">{country}</span>
      <span className="text-[0.72rem] leading-tight text-ink-2">
        <span className="block font-semibold text-ink">{t(`country.${country}` as MessageKey)}</span>
        {orders === 1 ? t("stamp.order") : t("stamp.orders", { n: orders })}, {makers.length === 1 ? t("stamp.maker") : t("stamp.makers", { n: makers.length })}
      </span>
    </li>
  );
}

export default async function BuyerJournal() {
  const buyer = await buyerPage();
  const t = await getT();
  const uiLocale = localeOf(await getUiLang());
  const [o, threads] = await Promise.all([buyerOverview(buyer.buyerId, buyer.market), listConversations(buyer)]);
  const k = o.kpis;
  const byCountry = new Map<string, { makers: string[]; orders: number }>();
  for (const m of o.makers) {
    const c = byCountry.get(m.country) ?? { makers: [], orders: 0 };
    c.makers.push(m.seller);
    c.orders += m.orders;
    byCountry.set(m.country, c);
  }
  const stamps = [...byCountry.entries()].sort((a, b) => b[1].orders - a[1].orders);
  const openThreads = threads.filter((t) => t.status === "OPEN").slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-3">
            {t("journal.shopping", { lang: t(`langname.${buyer.market.slice(0, 2)}` as MessageKey), currency: o.reference_currency })}
          </p>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("journal.title", { name: buyer.name.split(" ")[0] ?? buyer.name })}</h1>
        </div>
        <Link href="/shop" className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-sheet">
          {t("journal.browse")}
        </Link>
      </header>

      <section aria-labelledby="passport-title" className="overflow-hidden rounded-[10px] border border-rule bg-accent-soft">
        <div className="grid gap-6 p-5 md:grid-cols-[17rem_minmax(0,1fr)] md:p-6">
          <div>
            <h2 id="passport-title" className="font-display text-xl font-semibold text-accent-ink">
              {t("passport.title")}
            </h2>
            <p className="mt-1 text-sm text-accent-ink">
              {t("passport.body", { makers: k.makers, countries: k.countries, spent: k.spent.display, reached: k.reached_makers.display, pct: formatBps(k.reached_bps, 0) })}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-accent-ink/80">{t("passport.orders")}</dt>
                <dd className="num font-display text-2xl font-semibold text-accent-ink">{k.orders}</dd>
              </div>
              <div>
                <dt className="text-accent-ink/80">{t("passport.refunds")}</dt>
                <dd className="num font-display text-2xl font-semibold text-accent-ink">{k.refunds}</dd>
              </div>
            </dl>
          </div>
          {stamps.length === 0 ? (
            <p className="self-center text-accent-ink">{t("passport.empty")}</p>
          ) : (
            <ul className="flex flex-wrap content-start gap-4 py-2" aria-label={t("passport.list")}>
              {stamps.map(([country, v], i) => (
                <PassportStamp key={country} country={country} makers={v.makers} orders={v.orders} rotate={[-3, 2, -1.5, 3, -2, 1][i % 6]!} t={t} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel labelledBy="spend-title">
          <SectionHeading id="spend-title" title={t("spend.title")} aside={t("spend.aside", { currency: o.reference_currency })} />
          <BuyerSpendChart months={o.monthly} currency={o.reference_currency} locale={buyer.market} title={t("spend.title")} />
        </Panel>
        <Panel labelledBy="threads-title">
          <SectionHeading id="threads-title" title={t("conv.title")} aside={<Link href="/buyer/messages" className="text-accent hover:underline">{t("conv.all")}</Link>} />
          {openThreads.length === 0 ? (
            <p className="text-sm text-ink-3">{t("conv.none")}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {openThreads.map((th) => (
                <li key={th.id}>
                  <Link href={`/buyer/messages?c=${th.id}`} className="flex gap-3 py-2.5 hover:bg-sheet-2">
                    <ProductThumb src={th.product?.image_url} alt="" size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${th.unread ? "font-semibold" : "text-ink-2"}`}>
                          {th.counterpart.name}
                          {th.unread > 0 && <span className="sr-only">, {t("conv.newReply")}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-ink-3">{formatDay(th.last_message_at, uiLocale)}</span>
                      </span>
                      <span className="block truncate text-sm text-ink-3">{th.last_message?.preview}</span>
                    </span>
                    {th.unread > 0 && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-alert" aria-hidden />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section aria-labelledby="purchases-title">
        <SectionHeading id="purchases-title" title={t("purch.title")} aside={<Link href="/orders" className="text-accent hover:underline">{t("purch.history")}</Link>} />
        <PurchasesGrid pageSize={10} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel labelledBy="makers-title">
          <SectionHeading id="makers-title" title={t("makers.title")} />
          <ul className="divide-y divide-rule">
            {o.makers.slice(0, 6).map((m) => (
              <li key={m.seller_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.seller}</span>
                  <span className="text-ink-3">
                    {t("makers.last", { country: t(`country.${m.country}` as MessageKey), date: formatDate(m.last_order, uiLocale) })}
                  </span>
                </span>
                <span className="num shrink-0 text-right">
                  <span className="block font-semibold">{m.spent.display}</span>
                  <span className="text-ink-3">{m.orders === 1 ? t("stamp.order") : t("stamp.orders", { n: m.orders })}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel labelledBy="popular-title">
          <SectionHeading id="popular-title" title={t("popular.title")} aside={t("popular.aside")} />
          {o.recommendations.length === 0 ? (
            <p className="text-sm text-ink-3">{t("popular.none")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {o.recommendations.map((r) => (
                <li key={r.listing_id} className="flex flex-col gap-2">
                  <ProductThumb src={r.image_url} alt="" size={96} />
                  <span className="text-sm leading-snug font-medium">{r.title}</span>
                  <span className="text-xs text-ink-3">{r.seller}</span>
                  <span className="num text-sm font-semibold">{r.price.display}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/shop" className="mt-4 inline-flex min-h-10 items-center text-sm font-medium text-accent hover:underline">
            {t("popular.see")}
          </Link>
        </Panel>
      </div>
      <p className="text-xs text-ink-3">{t("journal.footnote", { currency: o.reference_currency })}</p>
    </div>
  );
}
