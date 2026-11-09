"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { api, decimalOf, type Money } from "@/components/api";
import { usePageAssistant } from "@/components/assistant/AssistantContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { IconBack, IconCheck } from "@/components/icons";
import { MarketStamp, ProductThumb } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/messages";
import { useBase } from "@/lib/use-base";
import { MarketPrices, type Positioning, POSITIONING_LABEL } from "./MarketPrices";

type Status = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type Listing = {
  id: string;
  locale: string;
  status: Status;
  title: string;
  description: string;
  seo_title: string;
  price: Money;
  pricing: {
    profit?: Money;
    margin_percent?: number;
    warnings?: { message: string }[];
    fees_are_estimates?: boolean;
    market?: { range: { low: Money; median: Money; high: Money }; position: string; offers_compared: number } | null;
  } | null;
  embedded: boolean;
};
type Data = {
  product: { id: string; sku: string; title: string; description: string; cost: Money; shipping: Money; margin_percent: number; attributes: unknown; image_url: string | null; category: string | null };
  listings: Listing[];
};

const SEO_MAX = 70;

const MARKET_POSITION: Record<string, string> = {
  BELOW_MARKET: "below every comparable price",
  LOWER_HALF: "below the median",
  UPPER_HALF: "above the median",
  ABOVE_MARKET: "above every comparable price",
};
const btn = "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${btn} bg-accent font-semibold text-sheet hover:brightness-95`;
const secondary = `${btn} border border-rule-strong font-medium text-ink-2 hover:bg-sheet-2 hover:text-ink`;
const field = "min-h-11 w-full rounded-md border border-rule-strong bg-sheet px-3 text-ink placeholder:text-ink-3 focus:border-accent";

/** Draft, published and archived differ by shape as well as colour. */
const STATUS_STYLE: Record<Status, { cls: string; mark: React.ReactNode }> = {
  PUBLISHED: { cls: "bg-positive-soft text-positive-ink", mark: <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" /> },
  DRAFT: {
    cls: "bg-gold-soft text-gold-ink",
    mark: (
      <>
        <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1 9 9 1v8z" fill="currentColor" />
      </>
    ),
  },
  ARCHIVED: { cls: "bg-sheet-2 text-ink-2", mark: <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> },
};

function StatusChip({ status }: { status: Status }) {
  const { t } = useI18n();
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[3px] px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
        {s.mark}
      </svg>
      {t(`pe.status.${status}` as MessageKey)}
    </span>
  );
}

function Labelled({ label, hint, children, id }: { label: string; hint?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function ListingCard({ l, onChange }: { l: Listing; onChange: () => void }) {
  const { t } = useI18n();
  const ids = useId();
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: l.title, description: l.description, seo_title: l.seo_title, price: decimalOf(l.price) });
  const [error, setError] = useState<string | null>(null);
  const market = `${l.locale.slice(3)} ${t(`langname.${l.locale.slice(0, 2)}` as MessageKey)}`;
  const seoLength = [...draft.seo_title].length;

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      setEdit(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pe.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-1.5">
          <MarketStamp locale={l.locale} />
          <StatusChip status={l.status} />
        </div>
        <p className="num font-display text-[1.6rem] leading-none font-semibold tracking-[-0.02em]">{l.price.display}</p>
      </header>
      {l.status === "PUBLISHED" && !l.embedded && <p className="-mt-1 text-xs text-ink-3">{t("pe.indexing")}</p>}

      {edit ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              api(`/api/listings/${l.id}`, { method: "PATCH", body: { title: draft.title, description: draft.description, seo_title: draft.seo_title, price: draft.price } }),
            );
          }}
        >
          <Labelled id={`${ids}-title`} label={t("pe.title")}>
            <input id={`${ids}-title`} className={field} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
          </Labelled>
          <Labelled
            id={`${ids}-seo`}
            label={t("pe.seoTitle")}
            hint={
              <span aria-live="polite" className={seoLength > SEO_MAX ? "font-semibold text-alert-ink" : ""}>
                {t("pe.seoCount", { n: seoLength, max: SEO_MAX })}
              </span>
            }
          >
            <input id={`${ids}-seo`} className={field} value={draft.seo_title} onChange={(e) => setDraft({ ...draft, seo_title: e.target.value })} required />
          </Labelled>
          <Labelled id={`${ids}-desc`} label={t("pe.description")}>
            <textarea id={`${ids}-desc`} className={`${field} min-h-28 py-2 leading-relaxed`} rows={5} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} required />
          </Labelled>
          <Labelled id={`${ids}-price`} label={t("pe.price", { currency: l.price.currency })}>
            <input id={`${ids}-price`} className={`${field} num max-w-40`} inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} required />
          </Labelled>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={busy || seoLength > SEO_MAX}>
              {busy ? t("pe.saving") : t("pe.saveDraft")}
            </button>
            <button type="button" className={secondary} disabled={busy} onClick={() => setEdit(false)}>
              {t("pe.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="min-w-0">
            <h3 className="font-semibold leading-snug text-ink">{l.title}</h3>
            <p className="mt-0.5 text-xs text-ink-3">
              {t("pe.seoTitle")}: {l.seo_title}
            </p>
            <p className="mt-2 line-clamp-4 text-[0.95rem] leading-relaxed whitespace-pre-wrap text-ink-2">{l.description}</p>
          </div>
          {l.pricing?.profit && (
            <p className="text-sm text-ink-2">
              {t("pe.profit", { profit: l.pricing.profit.display, margin: l.pricing.margin_percent ?? 0 })}
              {l.pricing.fees_are_estimates ? <span className="text-ink-3"> · {t("pe.feeEstimates")}</span> : null}
            </p>
          )}
          {l.pricing?.market && (
            <p className="text-sm text-ink-3">
              Market {l.pricing.market.range.low.display}–{l.pricing.market.range.high.display} (median {l.pricing.market.range.median.display},{" "}
              {l.pricing.market.offers_compared} offers) · {MARKET_POSITION[l.pricing.market.position] ?? l.pricing.market.position}
            </p>
          )}
          {l.pricing?.warnings?.map((w) => (
            <p key={w.message} role="note" className="rounded-md bg-gold-soft px-3 py-2 text-sm text-gold-ink">
              {w.message}
            </p>
          ))}
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            {l.status !== "PUBLISHED" && (
              <button
                type="button"
                className={primary}
                disabled={busy}
                aria-label={t("pe.publishAria", { market })}
                onClick={() => void act(() => api(`/api/listings/${l.id}/publish`, { method: "POST" }))}
              >
                {t("pe.publish")}
              </button>
            )}
            {l.status === "PUBLISHED" && (
              <button
                type="button"
                className={secondary}
                disabled={busy}
                aria-label={t("pe.unpublishAria", { market })}
                onClick={() => void act(() => api(`/api/listings/${l.id}/unpublish`, { method: "POST" }))}
              >
                {t("pe.unpublish")}
              </button>
            )}
            <button type="button" className={secondary} disabled={busy} aria-label={t("pe.editAria", { market })} onClick={() => setEdit(true)}>
              {t("pe.edit")}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft px-3 py-2 text-sm text-alert-ink">
          {error}
        </p>
      )}
    </article>
  );
}

type MarketInfo = { locale: string; language: string; currency: string };
type LocalizeResult = {
  saved: { listing_id: string; market: string; price: Money; profit: Money; margin_percent: number; market_position: string | null }[];
  failed: { market: string; error: string }[];
};

/** One click: pick markets, get priced and translated drafts. Prices are calculated by code; the AI writes the text. */
function CreateListings({ productId, existing, positioning, onDone }: { productId: string; existing: string[]; positioning: Positioning; onDone: () => void }) {
  const { t } = useI18n();
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LocalizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ markets: MarketInfo[] }>("/api/markets").then((r) => setMarkets(r.markets));
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<LocalizeResult>(`/api/products/${productId}/localize`, { body: { markets: chosen, positioning } });
      setResult(r);
      setChosen([]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pe.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (locale: string) => setChosen((c) => (c.includes(locale) ? c.filter((x) => x !== locale) : [...c, locale]));
  const missing = markets.filter((m) => !existing.includes(m.locale)).map((m) => m.locale);
  const label = chosen.length === 0 ? t("pe.createNone") : chosen.length === 1 ? t("pe.createOne") : t("pe.create", { n: chosen.length });
  return (
    <section aria-labelledby="sell-more" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <h2 id="sell-more" className="font-display text-xl font-semibold tracking-[-0.01em]">
        {t("pe.sellMore")}
      </h2>
      <p className="mt-1 max-w-[70ch] text-ink-3">{t("pe.sellMoreHelp")}</p>
      <p className="mt-1 max-w-[70ch] text-sm text-ink-3">
        Markets with checked prices are priced <strong className="text-ink-2">{POSITIONING_LABEL[positioning].title.toLowerCase()}</strong> ({POSITIONING_LABEL[positioning].hint}), never below your target margin; the rest from cost and margin.
      </p>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("pe.sellMore")}>
        {markets.map((m) => {
          const on = chosen.includes(m.locale);
          return (
            <label key={m.locale} className="cursor-pointer">
              <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(m.locale)} disabled={busy} />
              <span
                className={`flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] peer-disabled:opacity-60 ${
                  on ? "border-accent bg-accent-soft text-ink" : "border-rule-strong bg-sheet text-ink-2 hover:border-ink-3 hover:bg-sheet-2"
                }`}
              >
                {on && <IconCheck className="h-4 w-4 text-accent" />}
                <MarketStamp locale={m.locale} />
                <span className="text-xs text-ink-3">{m.currency}</span>
                {existing.includes(m.locale) && <span className="rounded-[3px] bg-gold-soft px-1.5 py-0.5 text-xs font-semibold text-gold-ink">{t("pe.replaces")}</span>}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy || chosen.length === 0} onClick={() => void create()}>
          {busy ? t("pe.writing") : label}
        </button>
        {missing.length > 0 && chosen.length === 0 && (
          <button type="button" className="min-h-11 cursor-pointer text-sm font-medium text-accent hover:underline" onClick={() => setChosen(missing)}>
            {t("pe.selectMissing")}
          </button>
        )}
        {chosen.length > 0 && !busy && (
          <button type="button" className="min-h-11 cursor-pointer text-sm text-ink-3 hover:text-ink hover:underline" onClick={() => setChosen([])}>
            {t("pe.clearSelection")}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-alert-soft px-3 py-2 text-sm text-alert-ink">
          {error}
        </p>
      )}
      {result && (
        <ul role="status" className="mt-3 space-y-1.5 text-sm">
          {result.saved.map((s) => (
            <li key={s.listing_id} className="flex items-start gap-2 text-positive-ink">
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
              {t("pe.savedLine", { market: s.market, price: s.price.display, profit: s.profit.display, margin: s.margin_percent })}
              {s.market_position ? ` · ${MARKET_POSITION[s.market_position] ?? s.market_position}` : ""}
            </li>
          ))}
          {result.failed.map((f) => (
            <li key={f.market} className="rounded-md bg-alert-soft px-3 py-2 text-alert-ink">
              {t("pe.failedLine", { market: f.market, error: f.error })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function attributeEntries(a: unknown): [string, string][] {
  if (!a || typeof a !== "object" || Array.isArray(a)) return [];
  return Object.entries(a as Record<string, unknown>).map(([k, v]) => [k.replaceAll("_", " "), typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)]);
}

const ORDER: Record<Status, number> = { DRAFT: 0, PUBLISHED: 1, ARCHIVED: 2 };

/** Product editor: one-click listings, per-market drafts with Publish buttons (the seller's approval), and an optional Listing Agent chat. */
export function ProductEditor({ productId }: { productId: string }) {
  const { t } = useI18n();
  const base = useBase();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positioning, setPositioning] = useState<Positioning>("market");
  const load = useCallback(
    () =>
      api<Data>(`/api/products/${productId}`)
        .then(setData)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : t("pe.error"))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // The assistant panel opens on the Listing agent for this product; reload after it replies (it may have saved drafts).
  usePageAssistant({ agent: "LISTING", productId, contextLabel: data?.product.title, onResult: () => void load() });

  // Drafts first: they are the ones waiting for the seller.
  const listings = useMemo(() => [...(data?.listings ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.locale.localeCompare(b.locale)), [data]);

  const back = (
    <Link href={`${base}/products`} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-accent hover:underline">
      <IconBack className="h-4 w-4" />
      {t("pe.back")}
    </Link>
  );
  if (error)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p role="alert" className="rounded-md bg-alert-soft px-4 py-3 text-alert-ink">
          {error}
        </p>
      </div>
    );
  if (!data)
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("pe.loading")}>
        {back}
        <div className="h-48 animate-pulse rounded-[10px] border border-rule bg-sheet-2" />
        <div className="h-40 animate-pulse rounded-[10px] border border-rule bg-sheet-2" />
      </div>
    );

  const p = data.product;
  const attrs = attributeEntries(p.attributes);
  const live = listings.filter((l) => l.status === "PUBLISHED").length;
  const drafts = listings.filter((l) => l.status === "DRAFT").length;
  return (
    <div className="flex flex-col gap-6">
      {back}

      <section aria-labelledby="product-title" className="overflow-hidden rounded-[12px] border border-rule bg-sheet shadow-[var(--shadow-overlay)]">
        <div className="flex flex-col gap-5 p-5 cq-sm:flex-row md:p-6">
          <ProductThumb src={p.image_url} alt="" size={112} />
          <div className="min-w-0 flex-1">
            <h1 id="product-title" className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] text-ink">
              {p.title}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
              <span className="num">{p.sku}</span>
              {p.category && <span className="rounded-[3px] bg-sheet-2 px-2 py-0.5 text-xs font-medium text-ink-2">{p.category}</span>}
              <span>{t("pe.summary", { live, drafts })}</span>
            </p>
            <p className="mt-3 max-w-[70ch] leading-relaxed whitespace-pre-wrap text-ink-2">{p.description}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-px border-t border-dashed border-rule-strong bg-rule">
          {[
            [t("pe.cost"), p.cost.display],
            [t("pe.shipping"), p.shipping.display],
            [t("pe.margin"), `${p.margin_percent}%`],
          ].map(([k, v]) => (
            <div key={k} className="bg-sheet-2 px-4 py-3 md:px-6">
              <dt className="text-sm text-ink-3">{k}</dt>
              <dd className="num mt-0.5 font-display text-xl font-semibold tracking-[-0.01em] sm:text-2xl">{v}</dd>
            </div>
          ))}
        </dl>
        {attrs.length > 0 && (
          <div className="border-t border-rule px-5 py-3 md:px-6">
            <h2 className="sr-only">{t("pe.attributes")}</h2>
            <dl className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
              {attrs.map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <dt className="text-ink-3 capitalize">{k}</dt>
                  <dd className="font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      <MarketPrices productId={p.id} positioning={positioning} onPositioning={setPositioning} onListingsChanged={() => void load()} />

      <CreateListings productId={p.id} existing={listings.map((l) => l.locale)} positioning={positioning} onDone={load} />

      <section aria-labelledby="listings-title">
        <h2 id="listings-title" className="mb-3 font-display text-xl font-semibold tracking-[-0.01em]">
          {t("pe.listings")}
        </h2>
        {listings.length === 0 && <p className="rounded-[10px] border border-dashed border-rule-strong px-5 py-6 text-ink-3">{t("pe.none")}</p>}
        <div className="grid gap-4 cq-md:grid-cols-2 cq-xl:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={`${l.id}-${l.status}-${l.price.amount_minor}-${l.title}`} l={l} onChange={load} />
          ))}
        </div>
      </section>
    </div>
  );
}
