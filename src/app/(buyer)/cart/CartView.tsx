"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";
import { type CaptureOutcome, PayPalButtons } from "@/components/PayPalButtons";

type Cart = {
  cart_id: string;
  seller: string;
  currency: string;
  status: string;
  items: { listing_id: string; title: string; quantity: number; unit_price: Money; line_total: Money }[];
  total: Money;
};

export function CartView({ paypalClientId, cancelled }: { paypalClientId: string | null; cancelled: boolean }) {
  const [carts, setCarts] = useState<Cart[]>([]);
  const [paid, setPaid] = useState<CaptureOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ carts: Cart[] }>("/api/cart").then((r) => setCarts(r.carts)), []);
  useEffect(() => {
    void load();
  }, [load]);
  const onPaid = useCallback(
    (o: CaptureOutcome) => {
      setPaid((p) => [...p, o]);
      void load();
    },
    [load],
  );

  async function setQty(listingId: string, quantity: number) {
    setError(null);
    try {
      const r = await api<{ carts: Cart[] }>("/api/cart", { method: "PATCH", body: { listing_id: listingId, quantity } });
      setCarts(r.carts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the cart.");
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cart</h1>
      {cancelled && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">PayPal checkout was cancelled. Nothing was charged.</p>}
      {paid.map((o) => (
        <p key={o.order_id} className="rounded bg-positive-soft p-2 text-sm text-positive-ink">
          Paid {o.total.display}. Order status: {o.order_status}.
        </p>
      ))}
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {carts.length === 0 && <p className="text-sm text-slate-500">Your cart is empty. Ask the shopping assistant to find something.</p>}
      {carts.map((c) => (
        <section key={c.cart_id} className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="font-semibold">
            {c.seller} · {c.currency}
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {c.items.map((i) => (
              <li key={i.listing_id} className="flex items-center gap-3 py-2">
                <span className="flex-1">{i.title}</span>
                <span>{i.unit_price.display}</span>
                <span className="flex items-center gap-1">
                  <button className="rounded border px-2" onClick={() => setQty(i.listing_id, i.quantity - 1)}>
                    −
                  </button>
                  {i.quantity}
                  <button className="rounded border px-2" onClick={() => setQty(i.listing_id, i.quantity + 1)}>
                    +
                  </button>
                </span>
                <span className="w-24 text-right font-medium">{i.line_total.display}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right font-semibold">Total {c.total.display} (shipping included)</p>
          <div className="mt-3 max-w-sm">
            <PayPalButtons clientId={paypalClientId} currency={c.currency} cartId={c.cart_id} onPaid={onPaid} />
          </div>
        </section>
      ))}
    </div>
  );
}
