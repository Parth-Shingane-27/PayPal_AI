import type { Metadata } from "next";
import Link from "next/link";
import { LanguagePicker } from "@/components/i18n/I18nProvider";
import { SaleWaybill } from "@/components/landing/SaleWaybill";
import { CountryStamp } from "@/components/ui";
import { formatCount } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { listMarkets } from "@/server/domain/markets";
import { gigMarketplaceStats } from "@/server/services/gig/dashboards";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "GlobalGig lets freelancers sell their services to clients in 11 markets. AI writes each service page in the client's language and sets rates per market, clients pay each milestone in their own currency through PayPal, and the money is held until they accept the work.";

export const metadata: Metadata = {
  title: { absolute: "GlobalGig: freelance for clients in eleven countries, paid safely by milestone" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: "GlobalGig: freelance for clients in eleven countries, paid safely by milestone", description: DESCRIPTION, url: "/" },
};

const STEP_KEYS = [
  ["land.s1t", "land.s1b"],
  ["land.s2t", "land.s2b"],
  ["land.s3t", "land.s3b"],
  ["land.s4t", "land.s4b"],
] as const;
const FAQ_KEYS = [
  ["land.q1", "land.a1"],
  ["land.q2", "land.a2"],
  ["land.q3", "land.a3"],
  ["land.q4", "land.a4"],
] as const;

export default async function Home() {
  const s = await gigMarketplaceStats();
  const t = await getT();
  const STEPS = STEP_KEYS.map(([a, b]) => ({ title: t(a), body: t(b) }));
  const FAQ = FAQ_KEYS.map(([a, b]) => ({ q: t(a), a: t(b) }));
  const markets = listMarkets();
  const base = process.env.APP_URL ?? "http://localhost:3000";

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "GlobalGig",
      url: base,
      logo: `${base}/icon.svg`,
      description: DESCRIPTION,
    },
    { "@context": "https://schema.org", "@type": "WebSite", name: "GlobalGig", url: base, inLanguage: "en" },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Featured services from GlobalGig freelancers",
      itemListElement: s.featured.map((f, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Service",
          name: f.title,
          provider: { "@type": "Person", name: f.freelancer },
          offers: { "@type": "Offer", price: (f.from_price.amount_minor / 100).toFixed(2), priceCurrency: f.from_price.currency },
        },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];

  const navLink = "rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-sheet-2 hover:text-ink";

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 md:px-6">
          <Link href="/" className="mr-auto flex items-center gap-2.5 rounded-md" aria-label="GlobalGig home">
            <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="#c99a2e" />
        <circle cx="16" cy="16" r="11" fill="none" stroke="#1a1514" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="2 2.2" />
        <path d="M9 16h14M16 9c2.4 2 3.5 4.3 3.5 7s-1.1 5-3.5 7c-2.4-2-3.5-4.3-3.5-7s1.1-5 3.5-7z" fill="none" stroke="#1a1514" strokeWidth="1.8" />
      </svg>
            <span className="font-display text-xl font-bold tracking-[-0.02em]">GlobalGig</span>
          </Link>
          <a href="#how" className={`${navLink} hidden sm:inline-flex`}>
            {t("land.how")}
          </a>
          <a href="#makers" className={`${navLink} hidden sm:inline-flex`}>
            {t("land.makers")}
          </a>
          <a href="#faq" className={`${navLink} hidden md:inline-flex`}>
            {t("land.questions")}
          </a>
          <LanguagePicker compact />
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-sheet hover:bg-accent">
            {t("land.try")}
          </Link>
        </nav>
      </header>

      <main id="main">
        <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-12 pb-16 md:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-accent">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
              {t("land.badge", { makers: s.freelancers, markets: s.markets })}
            </p>
            <h1 id="hero-title" className="font-display text-[2.6rem] leading-[1.02] font-bold tracking-[-0.035em] text-ink sm:text-[3.4rem] lg:text-[4.1rem]">
              {t("land.h1")}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">{t("land.lede")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="inline-flex min-h-12 items-center rounded-md bg-accent px-6 font-semibold text-sheet hover:opacity-90">
                {t("land.try")}
              </Link>
              <a href="#how" className="inline-flex min-h-12 items-center rounded-md border border-rule-strong px-6 font-semibold text-ink hover:border-ink">
                {t("land.seeHow")}
              </a>
            </div>
          </div>
          <SaleWaybill bps={s.anatomy_bps} orders={s.milestones_90d} makers={s.freelancers} />
        </section>

        <section id="how" aria-labelledby="how-title" className="border-y border-rule bg-sheet">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
            <h2 id="how-title" className="max-w-2xl font-display text-3xl font-bold tracking-[-0.025em] md:text-4xl">
              {t("land.howTitle")}
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative border-t-2 border-ink pt-5">
                  <span className="num font-display text-5xl leading-none font-bold text-accent" aria-hidden>
                    {i + 1}
                  </span>
                  <h3 className="mt-3 font-display text-xl font-semibold">{step.title}</h3>
                  <p className="mt-2 text-ink-2">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="markets-title" className="mx-auto max-w-6xl px-4 py-16 md:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="markets-title" className="max-w-xl font-display text-3xl font-bold tracking-[-0.025em] md:text-4xl">
              {t("land.marketsTitle")}
            </h2>
            <p className="max-w-sm text-ink-3">{t("land.marketsNote")}</p>
          </div>
          <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {markets.map((m) => (
              <li
                key={m.locale}
                className="group flex flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-accent"
              >
                <CountryStamp country={m.country} />
                <span>
                  <span className="block font-semibold">{t(`country.${m.country}` as MessageKey)}</span>
                  <span className="text-sm text-ink-3">
                    {t(`langname.${m.locale.slice(0, 2)}` as MessageKey)}, {m.currency}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section id="makers" aria-labelledby="makers-title" className="border-y border-rule bg-sheet">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
            <h2 id="makers-title" className="font-display text-3xl font-bold tracking-[-0.025em] md:text-4xl">
              {t("land.makersTitle", { n: s.freelancers, c: new Set(s.featured.map((f) => f.country)).size })}
            </h2>
            <ul className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
              {s.featured.map((f) => (
                <li key={f.page_id} className="group flex flex-col gap-2 rounded-[10px] border border-rule bg-paper p-4 transition-colors hover:border-accent">
                  <p className="flex items-center gap-1.5 text-xs text-ink-3">
                    <CountryStamp country={f.country} />
                    <span className="truncate font-medium text-ink-2">{f.freelancer}</span>
                  </p>
                  <h3 className="text-sm leading-snug font-semibold">{f.title}</h3>
                  <p className="text-xs text-ink-3">{f.category}</p>
                  <p className="num mt-auto pt-2 font-display font-semibold">{t("land.from", { price: f.from_price.display })}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="numbers-title" className="mx-auto max-w-6xl px-4 py-16 md:px-6">
          <h2 id="numbers-title" className="font-display text-3xl font-bold tracking-[-0.025em] md:text-4xl">
            {t("land.numbersTitle")}
          </h2>
          <dl className="mt-8 grid gap-px overflow-hidden rounded-[10px] border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {[
              [t("land.n1"), formatCount(s.milestones_90d)],
              [t("land.n2"), s.released_90d.display],
              [t("land.n3"), `${(s.anatomy_bps.net / 100).toFixed(1)}%`],
              [t("land.n4"), t("land.n4v", { n: s.markets })],
            ].map(([label, value]) => (
              <div key={label} className="bg-sheet p-5">
                <dt className="text-sm text-ink-3">{label}</dt>
                <dd className="num mt-1 font-display text-3xl font-bold tracking-[-0.02em]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-ink-3">{t("land.numbersNote")}</p>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="border-t border-rule bg-sheet">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <h2 id="faq-title" className="font-display text-3xl font-bold tracking-[-0.025em] md:text-4xl">
              {t("land.faqTitle")}
            </h2>
            <div className="divide-y divide-rule border-y border-rule">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="flex min-h-11 list-none items-center justify-between gap-4 font-semibold hover:text-accent [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="text-xl leading-none text-ink-3 transition-transform duration-200 group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-2 max-w-prose text-ink-2">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="bg-ink text-sheet">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14 md:px-6">
            <div>
              <h2 id="cta-title" className="font-display text-3xl font-bold tracking-[-0.025em]">
                {t("land.ctaTitle")}
              </h2>
              <p className="mt-2 max-w-xl text-sheet/80">{t("land.ctaBody")}</p>
            </div>
            <Link href="/login" className="inline-flex min-h-12 items-center rounded-md bg-accent px-6 font-semibold text-sheet hover:opacity-90">
              {t("land.try")}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-3 md:px-6">
          <p>{t("land.footer")}</p>
          <nav aria-label="Footer" className="flex gap-4">
            <a href="#how" className="hover:text-ink">
              {t("land.how")}
            </a>
            <Link href="/login" className="hover:text-ink">
              {t("land.try")}
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
