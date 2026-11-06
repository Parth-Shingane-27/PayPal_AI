"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { api, type Money } from "@/components/api";
import { IconMessages } from "@/components/icons";
import { CountryStamp } from "@/components/ui";

export type ShopListing = {
  listing_id: string;
  product_id: string;
  title: string;
  summary: string;
  price: Money;
  seller: string;
  seller_country: string;
  image_url: string | null;
  category: string | null;
  rating: number | null;
  rating_count: number;
};

function AskMaker({ listing, onDone }: { listing: ShopListing; onDone: (threadId: string) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className="mt-3 flex flex-col gap-2 border-t border-dashed border-rule-strong pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ id: string }>("/api/messages", { body: { product_id: listing.product_id, body } });
          onDone(r.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : "The message was not sent.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Message {listing.seller}
      </label>
      <textarea
        id={id}
        rows={3}
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Ask about sizing, shipping to your country, or a custom order."
        className="rounded-md border border-rule-strong bg-sheet px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent"
        required
      />
      {error && <p className="text-sm text-alert-ink">{error}</p>}
      <button type="submit" disabled={busy || !body.trim()} className="min-h-11 rounded-md bg-ink px-3 text-sm font-semibold text-sheet disabled:opacity-50">
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}

/** Everything for sale in the buyer's market, with one-click "Add to cart" and a direct line to the maker. */
export function ProductList({ listings }: { listings: ShopListing[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, number>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("All");
  const categories = ["All", ...Array.from(new Set(listings.map((l) => l.category).filter((c): c is string => Boolean(c)))).sort()];
  const shown = category === "All" ? listings : listings.filter((l) => l.category === category);

  async function add(listingId: string) {
    setBusy(listingId);
    setError(null);
    try {
      await api("/api/cart", { body: { listing_id: listingId, quantity: 1 } });
      setAdded((a) => ({ ...a, [listingId]: (a[listingId] ?? 0) + 1 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add to the cart.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="shop-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="shop-title" className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">
            Shop
          </h1>
          <p className="text-ink-3">{listings.length} pieces from makers in other countries, priced in your currency with shipping included.</p>
        </div>
        <Link href="/cart" className="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:border-accent hover:text-accent">
          Go to cart
        </Link>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={`min-h-10 rounded-full border px-3.5 text-sm ${category === c ? "border-ink bg-ink font-semibold text-sheet" : "border-rule-strong text-ink-2 hover:border-ink"}`}
          >
            {c}
          </button>
        ))}
      </div>
      {error && <p className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">{error}</p>}
      {shown.length === 0 ? (
        <p className="text-ink-3">Nothing is for sale in this market yet. Pick another market at the top.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((l) => (
            <li key={l.listing_id} className="group flex flex-col overflow-hidden rounded-[10px] border border-rule bg-sheet transition-colors hover:border-accent/70">
              {l.image_url && (
                <div className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.image_url} alt={l.title} width={240} height={240} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                </div>
              )}
              <div className="flex flex-1 flex-col p-4">
                <h2 className="font-display text-lg leading-snug font-semibold">{l.title}</h2>
                <p className="mt-1 flex items-center gap-2 text-sm text-ink-3">
                  <CountryStamp country={l.seller_country} />
                  <span className="truncate">{l.seller}</span>
                  {l.rating !== null && (
                    <span className="num ml-auto shrink-0" title={`${l.rating_count} ratings`}>
                      {l.rating.toFixed(1)} of 5
                    </span>
                  )}
                </p>
                <p className="mt-2 flex-1 text-sm text-ink-2">{l.summary}</p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="num font-display text-xl font-semibold">{l.price.display}</span>
                  <button
                    className="min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-sheet disabled:opacity-50"
                    disabled={busy === l.listing_id}
                    onClick={() => add(l.listing_id)}
                  >
                    {busy === l.listing_id ? "Adding…" : "Add to cart"}
                  </button>
                </div>
                {added[l.listing_id] && (
                  <p className="mt-2 text-sm text-positive-ink" role="status">
                    Added {added[l.listing_id]} to your cart.
                  </p>
                )}
                {sent[l.listing_id] ? (
                  <p className="mt-3 text-sm text-positive-ink" role="status">
                    Message sent.{" "}
                    <Link href={`/buyer/messages?c=${sent[l.listing_id]}`} className="font-medium text-accent underline">
                      Open the conversation
                    </Link>
                  </p>
                ) : asking === l.listing_id ? (
                  <AskMaker listing={l} onDone={(id) => setSent((s) => ({ ...s, [l.listing_id]: id }))} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAsking(l.listing_id)}
                    className="mt-3 inline-flex min-h-10 items-center gap-1.5 self-start rounded-md text-sm font-medium text-accent hover:underline"
                  >
                    <IconMessages className="h-4 w-4" />
                    Ask the maker
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
