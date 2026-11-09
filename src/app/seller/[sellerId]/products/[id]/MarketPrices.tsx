"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";

export type Positioning = "competitive" | "market" | "premium";

export const POSITIONING_LABEL: Record<Positioning, { title: string; hint: string }> = {
  competitive: { title: "Competitive", hint: "lower quartile of market prices" },
  market: { title: "Match the market", hint: "median market price" },
  premium: { title: "Premium", hint: "upper quartile of market prices" },
};

type Offer = {
  source: "web" | "globalcart";
  shop: string;
  title: string;
  url: string | null;
  match: "same_product" | "comparable";
  listed_price: string;
  pack_quantity: number;
  unit_price: Money;
  price_on_page: boolean | null;
};
type Research = {
  market: string;
  currency: string;
  researched_at: string;
  stats: { count: number; outliers: number } | null;
  range: { low: Money; p25: Money; median: Money; p75: Money; high: Money } | null;
  offers: Offer[];
  your_listing: { listing_id: string; status: string; price: Money } | null;
  web: { status: "ok" | "no_offers" | "failed"; error: string | null };
  globalcart: { note: string | null };
  notes: string[];
};
type Suggestion = { price: Money; profit: Money; margin_percent: number; strategy: string; warnings: { code: string; message: string }[] } | { error: string };
type Pricing = { margin_floor_price: Money; cost_based_price: Money; by_positioning: Record<Positioning, Suggestion> } | null;
type Row = { market: string; research_id: string; cached?: boolean; result: Research; pricing: Pricing };
type Outcome = Row | { market: string; error: string };
type MarketInfo = { locale: string; language: string; currency: string };

const POSITION_TEXT: Record<string, string> = {
  BELOW_MARKET: "below every offer",
  LOWER_HALF: "below median",
  UPPER_HALF: "above median",
  ABOVE_MARKET: "above every offer",
};

function positionOf(price: Money, r: Research): string | null {
  if (!r.range || price.currency !== r.currency) return null;
  const p = price.amount_minor;
  if (p < r.range.low.amount_minor) return POSITION_TEXT.BELOW_MARKET!;
  if (p > r.range.high.amount_minor) return POSITION_TEXT.ABOVE_MARKET!;
  return p <= r.range.median.amount_minor ? POSITION_TEXT.LOWER_HALF! : POSITION_TEXT.UPPER_HALF!;
}

/** A tiny bar: market range low–high, the median tick, and where a price falls. */
function RangeBar({ r, price }: { r: Research; price: Money | null }) {
  if (!r.range) return null;
  const lo = r.range.low.amount_minor;
  const hi = r.range.high.amount_minor;
  const span = Math.max(1, hi - lo);
  const pad = span * 0.15;
  const min = lo - pad;
  const max = hi + pad;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div className="relative mt-1 h-2 w-40 rounded bg-sheet-2" aria-hidden>
      <div className="absolute inset-y-0 rounded bg-accent-soft" style={{ left: at(r.range.p25.amount_minor), right: `calc(100% - ${at(r.range.p75.amount_minor)})` }} />
      <div className="absolute inset-y-0 w-px bg-accent" style={{ left: at(r.range.median.amount_minor) }} />
      {price && price.currency === r.currency && (
        <div className="absolute -top-0.5 h-3 w-1.5 -translate-x-1/2 rounded-sm bg-gold-ink" style={{ left: at(price.amount_minor) }} />
      )}
    </div>
  );
}

/**
 * "What does this sell for?": per market, prices of comparable products in
 * that country's online shops and on GlobalCart, checked and converted by
 * code, next to the seller's price and what each positioning would charge.
 */
export function MarketPrices({
  productId,
  positioning,
  onPositioning,
  onListingsChanged,
}: {
  productId: string;
  positioning: Positioning;
  onPositioning: (p: Positioning) => void;
  onListingsChanged: () => void;
}) {
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [rows, setRows] = useState<Map<string, Outcome>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ markets: Row[] }>(`/api/products/${productId}/market-prices`)
        .then((r) => setRows((prev) => new Map([...prev, ...r.markets.map((m) => [m.market, m] as const)])))
        .catch(() => undefined),
    [productId],
  );
  useEffect(() => {
    void api<{ markets: MarketInfo[] }>("/api/markets").then((r) => setMarkets(r.markets));
    void load();
  }, [load]);

  async function research(refresh: boolean) {
    setError(null);
    const queue = [...chosen];
    setBusy(new Set(queue));
    // One request per market, two at a time, so results appear as they arrive.
    const runOne = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const r = await api<{ markets: Outcome[] }>(`/api/products/${productId}/market-prices`, { body: { markets: [m], refresh } });
          setRows((prev) => new Map(prev).set(m, r.markets[0]!));
        } catch (e) {
          setRows((prev) => new Map(prev).set(m, { market: m, error: e instanceof Error ? e.message : "Research failed." }));
        } finally {
          setBusy((prev) => {
            const next = new Set(prev);
            next.delete(m);
            return next;
          });
        }
      }
    };
    await Promise.all([runOne(), runOne()]);
  }

  async function applyPrice(listingId: string) {
    setError(null);
    try {
      await api(`/api/listings/${listingId}/reprice`, { body: { positioning } });
      onListingsChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the price.");
    }
  }

  const toggle = (locale: string) => setChosen((c) => (c.includes(locale) ? c.filter((x) => x !== locale) : [...c, locale]));
  const shown = markets.filter((m) => rows.has(m.locale) || busy.has(m.locale));
  const running = busy.size > 0;

  return (
    <section className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Market prices</h2>
      <p className="mt-1 max-w-[70ch] text-ink-3">
        See what comparable products sell for in each country before you set a price. We search that country&rsquo;s online shops and other GlobalCart sellers, convert every price into the local currency at today&rsquo;s rate, and show where your price would sit.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {markets.map((m) => (
          <label key={m.locale} className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-sm ${chosen.includes(m.locale) ? "border-accent bg-accent-soft text-ink" : "border-rule-strong"}`}>
            <input type="checkbox" checked={chosen.includes(m.locale)} onChange={() => toggle(m.locale)} disabled={running} />
            {m.language} <span className="text-xs text-ink-3">({m.currency})</span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-sheet hover:brightness-95 disabled:opacity-50" disabled={running || chosen.length === 0} onClick={() => research(false)}>
          {running ? `Checking ${busy.size} market${busy.size === 1 ? "" : "s"}…` : "Check market prices"}
        </button>
        <button className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm text-ink-2 hover:bg-sheet-2 disabled:opacity-50" disabled={running || chosen.length === 0} onClick={() => research(true)} title="Search again even if prices were checked in the last 24 hours">
          Refresh
        </button>
        <span className="ml-auto text-sm text-ink-2">Price my listings:</span>
        <select className="min-h-11 rounded-md border border-rule-strong bg-sheet px-2 text-sm text-ink" value={positioning} onChange={(e) => onPositioning(e.target.value as Positioning)}>
          {(Object.keys(POSITIONING_LABEL) as Positioning[]).map((p) => (
            <option key={p} value={p}>
              {POSITIONING_LABEL[p].title} ({POSITIONING_LABEL[p].hint})
            </option>
          ))}
        </select>
      </div>
      {running && <p className="mt-2 text-xs text-ink-3">Each market takes about 10–20 seconds.</p>}
      {error && <p className="mt-2 rounded-md bg-alert-soft px-3 py-2 text-sm text-alert-ink">{error}</p>}

      {shown.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-rule text-xs uppercase text-ink-3">
              <tr>
                <th className="py-2 pr-3">Market</th>
                <th className="py-2 pr-3">Market range</th>
                <th className="py-2 pr-3">Your price</th>
                <th className="py-2 pr-3">Lowest at your margin</th>
                <th className="py-2 pr-3">{POSITIONING_LABEL[positioning].title} price</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const row = rows.get(m.locale);
                if (busy.has(m.locale) || !row) {
                  return (
                    <tr key={m.locale} className="border-b border-rule">
                      <td className="py-2 pr-3 font-mono">{m.locale}</td>
                      <td className="py-2 text-ink-3" colSpan={5}>
                        Searching shops in this market…
                      </td>
                    </tr>
                  );
                }
                if ("error" in row) {
                  return (
                    <tr key={m.locale} className="border-b border-rule">
                      <td className="py-2 pr-3 font-mono">{m.locale}</td>
                      <td className="py-2 text-alert-ink" colSpan={5}>
                        {row.error}
                      </td>
                    </tr>
                  );
                }
                const r = row.result;
                const s = row.pricing?.by_positioning[positioning];
                const suggestion = s && !("error" in s) ? s : null;
                const yours = r.your_listing?.price ?? null;
                const isOpen = open === m.locale;
                return (
                  <Fragment key={m.locale}>
                    <tr className="border-b border-rule align-top">
                      <td className="py-2 pr-3">
                        <span className="font-mono font-semibold">{m.locale}</span>
                        <p className="text-xs text-ink-3">{new Date(r.researched_at).toLocaleDateString()}</p>
                      </td>
                      <td className="py-2 pr-3">
                        {r.range ? (
                          <>
                            <span className="whitespace-nowrap">
                              {r.range.low.display} – <strong>{r.range.median.display}</strong> – {r.range.high.display}
                            </span>
                            <RangeBar r={r} price={yours ?? suggestion?.price ?? null} />
                            <p className="mt-0.5 text-xs text-ink-3">
                              {r.stats?.count} comparable price{r.stats?.count === 1 ? "" : "s"} · median in bold
                            </p>
                          </>
                        ) : (
                          <span className="text-ink-3">{r.web.status === "failed" ? `Search failed: ${r.web.error}` : "No comparable prices found"}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {yours ? (
                          <>
                            {yours.display}
                            <p className="text-xs text-ink-3">
                              {r.your_listing!.status.toLowerCase()}
                              {positionOf(yours, r) ? ` · ${positionOf(yours, r)}` : ""}
                            </p>
                          </>
                        ) : (
                          <span className="text-ink-3">not listed</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{row.pricing?.margin_floor_price.display ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {suggestion ? (
                          <>
                            <strong>{suggestion.price.display}</strong>
                            <p className="text-xs text-ink-2">
                              profit {suggestion.profit.display} ({suggestion.margin_percent}%)
                            </p>
                            {suggestion.warnings
                              .filter((w) => w.code !== "NO_MARKET_DATA")
                              .map((w) => (
                                <p key={w.code} className="text-xs text-gold-ink">
                                  {w.message}
                                </p>
                              ))}
                            {r.your_listing && suggestion.price.amount_minor !== yours?.amount_minor && (
                              <button className="mt-1 rounded-md border border-rule-strong px-2 py-1 text-xs text-ink-2 hover:bg-sheet-2" onClick={() => applyPrice(r.your_listing!.listing_id)}>
                                Use {suggestion.price.display} (saves as draft)
                              </button>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {r.offers.length > 0 && (
                          <button className="text-xs text-accent underline" onClick={() => setOpen(isOpen ? null : m.locale)}>
                            {isOpen ? "Hide" : `${r.offers.length} offers`}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-sheet-2">
                        <td colSpan={6} className="px-2 py-2">
                          <ul className="space-y-1">
                            {r.offers.map((o, i) => (
                              <li key={`${o.url ?? o.title}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                <span className="w-20 shrink-0 font-semibold">{o.unit_price.display}</span>
                                <span className="text-ink-3">{o.listed_price !== o.unit_price.display ? `(${o.listed_price})` : ""}</span>
                                {o.url ? (
                                  <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
                                    {o.title}
                                  </a>
                                ) : (
                                  <span>{o.title}</span>
                                )}
                                <span className="text-ink-3">· {o.shop}</span>
                                {o.match === "same_product" && <span className="rounded bg-accent-soft px-1 text-ink">same product</span>}
                                {o.price_on_page === false && <span className="rounded bg-gold-soft px-1 text-gold-ink">price not confirmed</span>}
                              </li>
                            ))}
                          </ul>
                          {[...r.notes, ...(r.globalcart.note ? [r.globalcart.note] : [])].map((n) => (
                            <p key={n} className="mt-1 text-xs text-ink-3">
                              {n}
                            </p>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-3">
            Observed prices from public shop pages, per unit, converted at today&rsquo;s ECB rate. Shops may or may not include VAT and shipping; GlobalCart prices include shipping. Profit uses estimated fees.
          </p>
        </div>
      )}
    </section>
  );
}
