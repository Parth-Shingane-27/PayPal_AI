"use client";

import { useCallback, useEffect, useState } from "react";
import { api, decimalOf, type Money } from "@/components/api";
import { AskAi } from "@/components/AskAi";
import { ChatPanel } from "@/components/ChatPanel";

type Listing = {
  id: string;
  locale: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  title: string;
  description: string;
  seo_title: string;
  price: Money;
  pricing: { profit?: Money; margin_percent?: number; warnings?: { message: string }[]; fees_are_estimates?: boolean } | null;
  embedded: boolean;
};
type Data = {
  product: { id: string; sku: string; title: string; description: string; cost: Money; shipping: Money; margin_percent: number; attributes: unknown };
  listings: Listing[];
};

function ListingCard({ l, onChange }: { l: Listing; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({ title: l.title, description: l.description, seo_title: l.seo_title, price: decimalOf(l.price) });
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setEdit(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    }
  }
  const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-mono font-semibold">{l.locale}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${l.status === "PUBLISHED" ? "bg-positive-soft text-positive-ink" : l.status === "DRAFT" ? "bg-amber-100 text-amber-800" : "bg-slate-200"}`}>{l.status}</span>
        {l.status === "PUBLISHED" && !l.embedded && <span className="text-xs text-slate-500">indexing for search…</span>}
        <span className="ml-auto font-semibold">{l.price.display}</span>
      </div>
      {edit ? (
        <div className="mt-2 space-y-2">
          <input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input className={input} value={draft.seo_title} onChange={(e) => setDraft({ ...draft, seo_title: e.target.value })} />
          <p className="text-xs text-slate-500">SEO title: {[...draft.seo_title].length}/70</p>
          <textarea className={input} rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <label className="flex items-center gap-2 text-xs">
            Price ({l.price.currency})
            <input className={input} inputMode="numeric" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <button
              className="rounded bg-blue-600 px-3 py-1 text-white"
              onClick={() =>
                act(() =>
                  api(`/api/listings/${l.id}`, {
                    method: "PATCH",
                    body: { title: draft.title, description: draft.description, seo_title: draft.seo_title, price: draft.price },
                  }),
                )
              }
            >
              Save as draft
            </button>
            <button className="rounded border px-3 py-1" onClick={() => setEdit(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 font-medium">{l.title}</p>
          <p className="text-xs text-slate-500">SEO: {l.seo_title}</p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-slate-700">{l.description}</p>
          {l.pricing?.profit && (
            <p className="mt-1 text-xs text-slate-600">
              Estimated profit {l.pricing.profit.display} · margin {l.pricing.margin_percent}%{l.pricing.fees_are_estimates ? " (fee estimates)" : ""}
            </p>
          )}
          {l.pricing?.warnings?.map((w) => (
            <p key={w.message} className="text-xs text-amber-700">
              {w.message}
            </p>
          ))}
          <div className="mt-2 flex gap-2">
            {l.status !== "PUBLISHED" && (
              <button className="rounded bg-accent px-3 py-1 text-white" onClick={() => act(() => api(`/api/listings/${l.id}/publish`, { method: "POST" }))}>
                Publish
              </button>
            )}
            {l.status === "PUBLISHED" && (
              <button className="rounded border px-3 py-1" onClick={() => act(() => api(`/api/listings/${l.id}/unpublish`, { method: "POST" }))}>
                Unpublish
              </button>
            )}
            <button className="rounded border px-3 py-1" onClick={() => setEdit(true)}>
              Edit
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

type MarketInfo = { locale: string; language: string; currency: string };
type LocalizeResult = {
  saved: { listing_id: string; market: string; price: Money; profit: Money; margin_percent: number }[];
  failed: { market: string; error: string }[];
};

/** One click: pick markets, get priced and translated drafts. Prices are calculated by code; the AI writes the text. */
function CreateListings({ productId, existing, onDone }: { productId: string; existing: string[]; onDone: () => void }) {
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
      const r = await api<LocalizeResult>(`/api/products/${productId}/localize`, { body: { markets: chosen } });
      setResult(r);
      setChosen([]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the listings.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (locale: string) => setChosen((c) => (c.includes(locale) ? c.filter((x) => x !== locale) : [...c, locale]));
  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Sell in more countries</h2>
      <p className="text-sm text-slate-600">Tick the markets, then click once. Each gets a local price and a listing written in its language, saved as a draft for you to check and publish.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {markets.map((m) => (
          <label key={m.locale} className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-sm ${chosen.includes(m.locale) ? "border-blue-500 bg-blue-50" : "border-slate-300"}`}>
            <input type="checkbox" checked={chosen.includes(m.locale)} onChange={() => toggle(m.locale)} disabled={busy} />
            {m.language} <span className="text-xs text-slate-500">({m.currency})</span>
            {existing.includes(m.locale) && <span className="text-xs text-amber-700">· replaces</span>}
          </label>
        ))}
      </div>
      <button className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || chosen.length === 0} onClick={create}>
        {busy ? "Writing listings…" : `Create ${chosen.length || ""} listing${chosen.length === 1 ? "" : "s"}`}
      </button>
      {error && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {result && (
        <div className="mt-2 space-y-1 text-sm">
          {result.saved.map((s) => (
            <p key={s.listing_id} className="text-positive-ink">
              ✓ {s.market}: {s.price.display} · profit {s.profit.display} ({s.margin_percent}%) — draft saved below
            </p>
          ))}
          {result.failed.map((f) => (
            <p key={f.market} className="text-red-700">
              ✗ {f.market}: {f.error}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** Product editor: one-click listings, per-market drafts with Publish buttons (the seller's approval), and an optional Listing Agent chat. */
export function ProductEditor({ productId }: { productId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<Data>(`/api/products/${productId}`)
        .then(setData)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the product.")),
    [productId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;
  const p = data.product;
  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">{p.title}</h1>
        <p className="text-sm text-slate-500">
          {p.sku} · cost {p.cost.display} + shipping {p.shipping.display} · target margin {p.margin_percent}%
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm">{p.description}</p>
        <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(p.attributes, null, 2)}</pre>
      </section>
      <CreateListings productId={p.id} existing={data.listings.map((l) => l.locale)} onDone={load} />
      <section>
        <h2 className="mb-2 font-semibold">Listings by market</h2>
        {data.listings.length === 0 && <p className="text-sm text-slate-500">No listings yet. Use &ldquo;Sell in more countries&rdquo; above.</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.listings.map((l) => (
            <ListingCard key={`${l.id}-${l.status}-${l.price.amount_minor}-${l.title}`} l={l} onChange={load} />
          ))}
        </div>
      </section>
      <AskAi label="Ask the listing assistant" hint="For anything special, e.g. matching a competitor price range or rewriting a description.">
        <ChatPanel
          title="Listing Agent"
          agent="LISTING"
          productId={p.id}
          placeholder='Try: "Localize this for Germany. Competitors there sell at 45–60 EUR."'
          onResult={load}
        />
      </AskAi>
    </div>
  );
}
