"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useState } from "react";
import { api, type Money } from "@/components/api";
import { openAssistant, usePageAssistant } from "@/components/assistant/AssistantContext";
import { errText, field, h1Cls, h2Cls, Notice, primaryBtn, secondaryBtn, Skeleton } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { IconBack, IconSpark } from "@/components/icons";
import { MarketStamp } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/messages";
import { useBase } from "@/lib/use-base";
import { servicePageText } from "./actions";
import { RateCheck } from "./RateCheck";

type Status = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type Page = {
  page_id: string;
  market: string;
  currency: string;
  status: Status;
  title: string;
  seo_title: string;
  hourly_rate: Money | null;
  prices: { tier: string | null; package_id: string; price: Money }[];
  published_at: string | null;
};
type OverviewMarket = {
  market: string;
  currency: string;
  page: { page_id: string; status: Status; price: Money | null; price_in_home_currency: Money | null } | null;
  contracts_started_90d: number;
  views_30d: number;
  quote_requests_30d: number;
  market_range: { low: Money; median: Money; high: Money; comparables: number; researched_at: string } | null;
  price_vs_market: "above_range" | "below_range" | "upper_half" | "lower_half" | null;
};
type Data = {
  service_id: string;
  code: string;
  title: string;
  description: string;
  written_in: string;
  category: string;
  tags: string[];
  pricing_model: "PACKAGES" | "HOURLY";
  home_currency: string;
  hourly_floor: Money;
  hourly_rate: Money | null;
  packages: { package_id: string; tier: string; scope: string; delivery_days: number; revisions: number; estimated_hours: number; floor_price_in_home_currency: Money }[];
  pages: Page[];
  overview: { published_in: number; markets: OverviewMarket[] };
};

const SEO_MAX = 70;

const STATUS_CLS: Record<Status, string> = {
  PUBLISHED: "bg-positive-soft text-positive-ink",
  DRAFT: "bg-gold-soft text-gold-ink",
  ARCHIVED: "bg-sheet-2 text-ink-2",
};

function StatusChip({ status }: { status: Status }) {
  const { t } = useI18n();
  return <span className={`inline-flex rounded-[3px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLS[status]}`}>{t(`pe.status.${status}` as MessageKey)}</span>;
}

/** Inline editor for one page's text; saving puts the page back to Draft. */
function PageTextForm({ page, onDone, onCancel }: { page: Page; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const ids = useId();
  const [draft, setDraft] = useState<{ title: string; description: string; seo_title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    servicePageText(page.page_id).then(
      (r) => alive && setDraft(r ?? { title: page.title, description: "", seo_title: page.seo_title }),
      () => alive && setError(t("fl.error")),
    );
    return () => {
      alive = false;
    };
  }, [page.page_id, page.title, page.seo_title, t]);

  if (!draft) return <p className="py-3 text-sm text-ink-3">{error ?? t("fl.loading")}</p>;
  const seoLength = [...draft.seo_title].length;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/service-pages/${page.page_id}`, { method: "PATCH", body: draft });
      onDone();
    } catch (err) {
      setError(errText(err, t("pe.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 py-3">
      <div>
        <label htmlFor={`${ids}-t`} className="mb-1 block text-sm font-medium">
          {t("pe.title")}
        </label>
        <input id={`${ids}-t`} lang={page.market} className={field} required maxLength={140} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${ids}-s`} className="mb-1 block text-sm font-medium">
          {t("pe.seoTitle")}
        </label>
        <input id={`${ids}-s`} lang={page.market} className={field} required value={draft.seo_title} onChange={(e) => setDraft({ ...draft, seo_title: e.target.value })} />
        <p aria-live="polite" className={`mt-1 text-xs ${seoLength > SEO_MAX ? "font-semibold text-alert-ink" : "text-ink-3"}`}>
          {t("pe.seoCount", { n: seoLength, max: SEO_MAX })}
        </p>
      </div>
      <div>
        <label htmlFor={`${ids}-d`} className="mb-1 block text-sm font-medium">
          {t("pe.description")}
        </label>
        <textarea id={`${ids}-d`} lang={page.market} className={`${field} min-h-32 py-2 leading-relaxed`} required maxLength={5000} rows={6} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </div>
      <p className="text-xs text-ink-3">{t("fl.page.backToDraft")}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryBtn} disabled={busy || seoLength > SEO_MAX || seoLength === 0}>
          {busy ? t("pe.saving") : t("pe.saveDraft")}
        </button>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onCancel}>
          {t("pe.cancel")}
        </button>
      </div>
    </form>
  );
}

function PagesTable({ data, onChange }: { data: Data; onChange: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hourly = data.pricing_model === "HOURLY";
  const tiers = data.packages.map((p) => p.tier);

  async function act(page: Page, action: "publish" | "unpublish") {
    setBusy(page.page_id);
    setError(null);
    try {
      await api(`/api/service-pages/${page.page_id}/${action}`, { method: "POST" });
      onChange();
    } catch (e) {
      setError(errText(e, t("pe.failed")));
    } finally {
      setBusy(null);
    }
  }

  const pages = [...data.pages].sort((a, b) => (a.status === b.status ? a.market.localeCompare(b.market) : a.status === "DRAFT" ? -1 : b.status === "DRAFT" ? 1 : 0));
  const cols = 3 + (hourly ? 1 : tiers.length);
  return (
    <section aria-labelledby="pages-title" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <h2 id="pages-title" className={h2Cls}>
        {t("fl.page.title")}
      </h2>
      <p className="mt-1 max-w-[70ch] text-ink-3">{t("fl.page.intro")}</p>
      <button type="button" onClick={() => openAssistant({ agent: "PROFILE" })} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-assist px-4 text-sm font-semibold text-assist-on hover:brightness-110">
        <IconSpark /> {t("fl.page.writeAi")}
      </button>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {pages.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-rule-strong px-4 py-5 text-ink-3">{t("fl.page.none")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-rule text-xs text-ink-3">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("col.market")}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("col.status")}
                </th>
                {hourly ? (
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("fl.svc.hourlyRate")}
                  </th>
                ) : (
                  tiers.map((tier) => (
                    <th key={tier} scope="col" className="py-2 pr-3 font-medium">
                      {t(`fl.tier.${tier}` as MessageKey)}
                    </th>
                  ))
                )}
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">{t("fl.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const market = `${p.market.slice(3)} ${t(`langname.${p.market.slice(0, 2)}` as MessageKey)}`;
                return (
                  <Fragment key={p.page_id}>
                    <tr className="border-b border-rule align-top">
                      <td className="py-2.5 pr-3">
                        <MarketStamp locale={p.market} />
                        <p lang={p.market} className="mt-1 max-w-[18rem] truncate text-xs text-ink-3" title={p.title}>
                          {p.title}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusChip status={p.status} />
                      </td>
                      {hourly ? (
                        <td className="num py-2.5 pr-3">{p.hourly_rate?.display ?? "–"}</td>
                      ) : (
                        tiers.map((tier) => (
                          <td key={tier} className="num py-2.5 pr-3">
                            {p.prices.find((x) => x.tier === tier)?.price.display ?? "–"}
                          </td>
                        ))
                      )}
                      <td className="py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {p.status !== "PUBLISHED" ? (
                            <button type="button" className={primaryBtn} disabled={busy === p.page_id} aria-label={t("pe.publishAria", { market })} onClick={() => void act(p, "publish")}>
                              {t("pe.publish")}
                            </button>
                          ) : (
                            <button type="button" className={secondaryBtn} disabled={busy === p.page_id} aria-label={t("pe.unpublishAria", { market })} onClick={() => void act(p, "unpublish")}>
                              {t("pe.unpublish")}
                            </button>
                          )}
                          <button
                            type="button"
                            className={secondaryBtn}
                            aria-expanded={editing === p.page_id}
                            aria-label={t("fl.page.editAria", { market })}
                            onClick={() => setEditing(editing === p.page_id ? null : p.page_id)}
                          >
                            {t("fl.page.editText")}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editing === p.page_id && (
                      <tr className="border-b border-rule bg-sheet-2/50">
                        <td colSpan={cols} className="px-2">
                          <PageTextForm
                            page={p}
                            onCancel={() => setEditing(null)}
                            onDone={() => {
                              setEditing(null);
                              onChange();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MarketOverview({ markets, pricedAs }: { markets: OverviewMarket[]; pricedAs: string }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="mo-title" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <h2 id="mo-title" className={h2Cls}>
        {t("fl.mo.title")}
      </h2>
      <p className="mt-1 max-w-[70ch] text-ink-3">{t("fl.mo.intro", { what: pricedAs })}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b border-rule text-xs text-ink-3">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("col.market")}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t("fl.mo.views")}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t("fl.mo.quotes")}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t("fl.mo.contracts")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("fl.mo.yourPrice")}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t("fl.mo.range")}
              </th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.market} className="border-b border-rule align-top last:border-0">
                <td className="py-2.5 pr-3">
                  <MarketStamp locale={m.market} />
                  {m.page && (
                    <span className="mt-1 block">
                      <StatusChip status={m.page.status} />
                    </span>
                  )}
                </td>
                <td className="num py-2.5 pr-3 text-right">{m.views_30d}</td>
                <td className="num py-2.5 pr-3 text-right">{m.quote_requests_30d}</td>
                <td className="num py-2.5 pr-3 text-right">{m.contracts_started_90d}</td>
                <td className="py-2.5 pr-3">
                  {m.page?.price ? (
                    <>
                      <span className="num font-semibold">{m.page.price.display}</span>
                      {m.page.price_in_home_currency && m.page.price_in_home_currency.currency !== m.page.price.currency && (
                        <span className="num block text-xs text-ink-3">≈ {m.page.price_in_home_currency.display}</span>
                      )}
                      {m.price_vs_market && <span className="block text-xs text-ink-2">{t(`fl.mo.pos.${m.price_vs_market}` as MessageKey)}</span>}
                    </>
                  ) : (
                    <span className="text-ink-3">{t("fl.svc.noPage")}</span>
                  )}
                </td>
                <td className="py-2.5">
                  {m.market_range ? (
                    <>
                      <span className="num whitespace-nowrap">
                        {m.market_range.low.display} – <strong>{m.market_range.median.display}</strong> – {m.market_range.high.display}
                      </span>
                      <span className="block text-xs text-ink-3">{t("fl.rates.comparables", { n: m.market_range.comparables })}</span>
                    </>
                  ) : (
                    <span className="text-ink-3">{t("fl.mo.notChecked")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">{t("fl.mo.note")}</p>
    </section>
  );
}

/** Service editor: facts, packages with floor prices, a page per market (publish is the freelancer's click), market overview and rate check. */
export function ServiceEditor({ serviceId }: { serviceId: string }) {
  const { t } = useI18n();
  const base = useBase();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<Data>(`/api/services/${serviceId}`).then(
        (d) => {
          setData(d);
          setError(null);
        },
        (e: unknown) => setError(errText(e, t("fl.error"))),
      ),
    [serviceId, t],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // The panel talks to the Profile agent about this service; reload after it replies (it may have saved drafts or prices).
  usePageAssistant({ agent: "PROFILE", subjectId: serviceId, contextLabel: data?.title, onResult: () => void load() });

  const back = (
    <Link href={`${base}/services`} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-accent hover:underline">
      <IconBack className="h-4 w-4" />
      {t("fl.nav.services")}
    </Link>
  );
  if (error && !data)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <Notice tone="error">{error}</Notice>
      </div>
    );
  if (!data)
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("fl.loading")}>
        {back}
        <Skeleton h="h-48" />
        <Skeleton />
      </div>
    );

  const hourly = data.pricing_model === "HOURLY";
  const live = data.pages.filter((p) => p.status === "PUBLISHED").length;
  const drafts = data.pages.filter((p) => p.status === "DRAFT").length;
  return (
    <div className="flex flex-col gap-6">
      {back}
      <section aria-labelledby="service-title" className="overflow-hidden rounded-[12px] border border-rule bg-sheet shadow-[var(--shadow-overlay)]">
        <div className="p-5 md:p-6">
          <h1 id="service-title" className={`${h1Cls} text-ink`}>
            {data.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <span className="num">{data.code}</span>
            <span className="rounded-[3px] bg-sheet-2 px-2 py-0.5 text-xs font-medium text-ink-2">{data.category}</span>
            <span>{hourly ? t("fl.svc.hourly") : t("fl.svc.packages")}</span>
            <span>
              {t("form.writtenIn")} <MarketStamp locale={data.written_in} />
            </span>
            <span>{t("pe.summary", { live, drafts })}</span>
          </p>
          <p lang={data.written_in} className="mt-3 max-w-[70ch] leading-relaxed whitespace-pre-wrap text-ink-2">
            {data.description}
          </p>
          {data.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("fl.svc.tags")}>
              {data.tags.map((tag) => (
                <li key={tag} className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-2">
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-dashed border-rule-strong bg-rule">
          <div className="bg-sheet-2 px-4 py-3 md:px-6">
            <dt className="text-sm text-ink-3">{t("fl.svc.hourlyFloor")}</dt>
            <dd className="num mt-0.5 font-display text-xl font-semibold">{data.hourly_floor.display}</dd>
          </div>
          <div className="bg-sheet-2 px-4 py-3 md:px-6">
            <dt className="text-sm text-ink-3">{t("fl.svc.homeCurrency")}</dt>
            <dd className="num mt-0.5 font-display text-xl font-semibold">{data.home_currency}</dd>
          </div>
        </dl>
      </section>

      {!hourly && data.packages.length > 0 && (
        <section aria-labelledby="pkg-title">
          <h2 id="pkg-title" className={`${h2Cls} mb-3`}>
            {t("fl.svc.packagesLegend")}
          </h2>
          <ul className="grid gap-4 cq-md:grid-cols-2 cq-xl:grid-cols-3">
            {data.packages.map((p) => (
              <li key={p.package_id} className="flex flex-col gap-2 rounded-[10px] border border-rule bg-sheet p-4">
                <h3 className="font-display text-lg font-semibold">{t(`fl.tier.${p.tier}` as MessageKey)}</h3>
                <p lang={data.written_in} className="text-[0.95rem] text-ink-2">
                  {p.scope}
                </p>
                <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 border-t border-rule pt-2 text-sm">
                  <dt className="text-ink-3">{t("fl.svc.deliveryDays")}</dt>
                  <dd className="num">{p.delivery_days}</dd>
                  <dt className="text-ink-3">{t("fl.svc.revisions")}</dt>
                  <dd className="num">{p.revisions}</dd>
                  <dt className="text-ink-3">{t("fl.svc.hours")}</dt>
                  <dd className="num">{p.estimated_hours}</dd>
                  <dt className="text-ink-3">{t("fl.svc.floor")}</dt>
                  <dd className="num font-semibold">{p.floor_price_in_home_currency.display}</dd>
                </dl>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">{t("fl.svc.floorNote")}</p>
        </section>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      <PagesTable data={data} onChange={() => void load()} />
      <MarketOverview markets={data.overview.markets} pricedAs={hourly ? t("fl.svc.hourlyRate") : t("fl.tier.STANDARD")} />
      <RateCheck serviceId={data.service_id} />
    </div>
  );
}
