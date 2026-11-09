"use client";

import { useState } from "react";
import { api, type Money } from "@/components/api";
import { MarketStamp } from "@/components/ui";

type Positioning = "competitive" | "market" | "premium";
type Offer = { source: "web" | "globalcart"; shop: string; title: string; url: string | null; unit_price: Money; listed_price: string; price_on_page: boolean | null };
type Result = {
  market: string;
  currency: string;
  stats: { count: number } | null;
  range: { low: Money; p25: Money; median: Money; p75: Money; high: Money } | null;
  offers: Offer[];
  web: { status: "ok" | "no_offers" | "failed"; error: string | null };
  notes: string[];
};
type Pricing = {
  margin_floor_price: Money;
  cost_based_price: Money;
  target_margin_percent: number;
  margin_at_market: Record<Positioning, number | null>;
};
type Outcome = { market: string; cached: boolean; result: Result; pricing: Pricing } | { market: string; error: string };

export type DraftFacts = { title: string; description: string; cost: string; shipping: string; currency: string; margin: string; attributes: Record<string, string> };

const MAX_MARKETS = 4;

/** Where the seller's price falls against the market range, in words. */
function verdict(price: Money, range: NonNullable<Result["range"]>): { text: string; tone: "ok" | "high" | "low" } {
  const p = price.amount_minor;
  if (p > range.high.amount_minor) return { text: "above every comparable price", tone: "high" };
  if (p > range.p75.amount_minor) return { text: "at the top of the market", tone: "high" };
  if (p < range.low.amount_minor) return { text: "below every comparable price", tone: "low" };
  if (p < range.p25.amount_minor) return { text: "at the cheap end of the market", tone: "low" };
  return { text: "within the typical range", tone: "ok" };
}

/**
 * "What does it sell for?" inside the add-product form: market prices for the
 * product being added, the price the typed cost and margin lead to, and the
 * margin at market prices, with one click to use that margin.
 */
export function DraftMarketPrices({ facts, markets, defaultMarket, onSetMargin }: { facts: DraftFacts; markets: readonly string[]; defaultMarket: string; onSetMargin: (percent: string) => void }) {
  const [chosen, setChosen] = useState<string[]>([defaultMarket]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Which margin the results were computed for: re-check after changing it.
  const [checkedMargin, setCheckedMargin] = useState<string | null>(null);

  const missing = !facts.title.trim() ? "a name" : !facts.description.trim() ? "a description" : !facts.cost.trim() ? "the cost" : null;

  async function check(refresh = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ markets: Outcome[] }>("/api/products/market-prices", {
        body: {
          title: facts.title,
          description: facts.description,
          cost: facts.cost,
          shipping: facts.shipping || "0",
          cost_currency: facts.currency,
          margin_percent: facts.margin || "30",
          attributes: facts.attributes,
          markets: chosen,
          refresh,
        },
      });
      setResults(r.markets);
      setCheckedMargin(facts.margin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check market prices.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (m: string) =>
    setChosen((c) => (c.includes(m) ? c.filter((x) => x !== m) : c.length >= MAX_MARKETS ? c : [...c, m]));

  return (
    <section aria-labelledby="draft-mp" className="rounded-md border border-rule bg-sheet-2 p-4">
      <h3 id="draft-mp" className="font-semibold text-ink">
        What does it sell for?
      </h3>
      <p className="mt-0.5 text-sm text-ink-3">
        Check prices of comparable products before you set your margin. Pick up to {MAX_MARKETS} markets; each takes about 10–20 seconds.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Markets to check">
        {markets.map((m) => {
          const on = chosen.includes(m);
          return (
            <label key={m} className="cursor-pointer">
              <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(m)} disabled={busy} />
              <span
                className={`flex min-h-9 items-center rounded-md border px-2 text-sm peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)] ${
                  on ? "border-accent bg-accent-soft" : "border-rule-strong bg-sheet hover:bg-sheet-2"
                }`}
              >
                <MarketStamp locale={m} />
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy || !!missing || chosen.length === 0}
          className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-sheet hover:opacity-90 disabled:opacity-50"
        >
          {busy ? `Checking ${chosen.length} market${chosen.length === 1 ? "" : "s"}…` : "Check market prices"}
        </button>
        {results && !busy && (
          <button type="button" onClick={() => void check(true)} className="min-h-11 px-2 text-sm text-ink-3 hover:text-ink hover:underline">
            Search again
          </button>
        )}
        {missing && <span className="text-xs text-ink-3">Enter {missing} first.</span>}
      </div>
      {results && checkedMargin !== facts.margin && !busy && (
        <p className="mt-2 text-xs text-gold-ink">You changed the margin: check again to update your prices (the market prices are reused, no new search).</p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-alert-soft px-3 py-2 text-sm text-alert-ink">
          {error}
        </p>
      )}

      {results && (
        <ul className="mt-3 flex flex-col gap-3">
          {results.map((o) => {
            if ("error" in o)
              return (
                <li key={o.market} className="rounded-md bg-alert-soft px-3 py-2 text-sm text-alert-ink">
                  {o.market}: {o.error}
                </li>
              );
            const r = o.result;
            const yours = o.pricing.cost_based_price;
            const v = r.range ? verdict(yours, r.range) : null;
            const atMedian = o.pricing.margin_at_market.market;
            return (
              <li key={o.market} className="rounded-md border border-rule bg-sheet p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <MarketStamp locale={o.market} />
                  {r.stats && <span className="text-xs text-ink-3">{r.stats.count} comparable prices</span>}
                </div>
                {r.range ? (
                  <>
                    <p className="mt-2 text-ink-2">
                      Market: <span className="num">{r.range.low.display}</span> – <strong className="num text-ink">{r.range.median.display}</strong> –{" "}
                      <span className="num">{r.range.high.display}</span> <span className="text-xs text-ink-3">(typical in bold)</span>
                    </p>
                    <p className="mt-1 text-ink-2">
                      Your price at {o.pricing.target_margin_percent}% margin: <strong className="num text-ink">{yours.display}</strong>{" "}
                      {v && <span className={v.tone === "ok" ? "text-positive-ink" : "text-gold-ink"}>· {v.text}</span>}
                    </p>
                    {atMedian !== null && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-ink-2">
                          At the typical price you would make <strong className="text-ink">{atMedian}%</strong> margin
                          {atMedian < 0 ? " (a loss)" : ""}.
                        </span>
                        {atMedian > 0 && Math.floor(atMedian) !== Number(facts.margin) && (
                          <button
                            type="button"
                            onClick={() => onSetMargin(String(Math.floor(atMedian)))}
                            className="min-h-9 rounded-md border border-rule-strong px-2.5 text-xs font-medium text-ink-2 hover:bg-sheet-2"
                          >
                            Use {Math.floor(atMedian)}% margin
                          </button>
                        )}
                      </div>
                    )}
                    {r.offers.length > 0 && (
                      <button type="button" onClick={() => setOpen(open === o.market ? null : o.market)} className="mt-2 text-xs text-accent hover:underline">
                        {open === o.market ? "Hide offers" : `See ${r.offers.length} offers`}
                      </button>
                    )}
                    {open === o.market && (
                      <ul className="mt-1 space-y-1">
                        {r.offers.map((x, i) => (
                          <li key={`${x.url ?? x.title}-${i}`} className="text-xs text-ink-2">
                            <span className="num font-semibold text-ink">{x.unit_price.display}</span>{" "}
                            {x.url ? (
                              <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
                                {x.title}
                              </a>
                            ) : (
                              x.title
                            )}{" "}
                            <span className="text-ink-3">· {x.shop}</span>
                            {x.price_on_page === false && <span className="text-gold-ink"> · price not confirmed</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-ink-3">
                    {r.web.status === "failed" ? r.web.error : "No comparable prices found."} Your price at {o.pricing.target_margin_percent}% margin would be{" "}
                    <strong className="num text-ink">{yours.display}</strong>.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {results && <p className="mt-2 text-xs text-ink-3">Prices from public shop pages, per unit, at today&rsquo;s exchange rate. Your prices include shipping and estimated fees.</p>}
    </section>
  );
}
