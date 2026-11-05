"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type Money } from "@/components/api";

export type ShopListing = { listing_id: string; title: string; summary: string; price: Money; seller: string };

/** Everything for sale in the buyer's market, with one-click "Add to cart". */
export function ProductList({ listings }: { listings: ShopListing[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

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
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Products</h1>
        <Link href="/cart" className="text-sm text-blue-700 hover:underline">
          Go to cart →
        </Link>
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {listings.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing is for sale in this market yet. Try another market.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <li key={l.listing_id} className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="font-medium">{l.title}</h2>
              <p className="text-xs text-slate-500">{l.seller}</p>
              <p className="mt-2 flex-1 text-sm text-slate-700">{l.summary}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="font-semibold">{l.price.display}</span>
                <button
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={busy === l.listing_id}
                  onClick={() => add(l.listing_id)}
                >
                  {busy === l.listing_id ? "Adding…" : "Add to cart"}
                </button>
              </div>
              {added[l.listing_id] && (
                <p className="mt-2 text-xs text-emerald-700">Added {added[l.listing_id]} to your cart.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
