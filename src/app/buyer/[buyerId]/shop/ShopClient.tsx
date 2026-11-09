"use client";

import Link from "next/link";
import { useState } from "react";
import { useBase } from "@/lib/use-base";
import { AskAi } from "@/components/AskAi";
import { type CartView, ChatPanel, type ShopDisplay } from "@/components/ChatPanel";
import { ProductList, type ShopListing } from "./ProductList";

/** The buyer's open carts, shown on the page when the agent views or changes the cart. */
function CartPanel({ carts, onHide }: { carts: CartView[]; onHide: () => void }) {
  const base = useBase();
  return (
    <section className="rounded-[10px] border border-assist bg-sheet" aria-label="Your cart">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-assist-soft px-4 py-3 text-assist-ink">
        <h2 className="font-display text-lg font-semibold">Your cart</h2>
        <span className="flex items-center gap-4 text-sm font-semibold">
          <Link href={`${base}/cart`} className="underline">
            Open cart page
          </Link>
          <button type="button" onClick={onHide} className="underline">
            Hide
          </button>
        </span>
      </div>
      {carts.length === 0 ? (
        <p className="p-4 text-ink-3">Your cart is empty.</p>
      ) : (
        <div className="divide-y divide-rule">
          {carts.map((c) => (
            <div key={c.cart_id} className="p-4">
              <p className="mb-2 font-semibold">{c.items.map((i) => i.title).join(" + ")}</p>
              <p className="mb-2 text-sm text-ink-3">
                Sold by {c.seller} · {c.currency}
              </p>
              <ul className="space-y-1.5">
                {c.items.map((i) => (
                  <li key={i.listing_id} className="flex items-baseline justify-between gap-3">
                    <span>
                      <span className="num text-ink-3">{i.quantity} ×</span> {i.title}
                    </span>
                    <span className="num font-semibold">{i.line_total.display}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex justify-between border-t border-dashed border-rule-strong pt-2 font-semibold">
                <span>Total</span>
                <span className="num">{c.total.display}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The shop grid plus the shopping agent. Products the agent recommends appear in the grid, not in the chat. */
export function ShopClient(props: {
  listings: ShopListing[];
  locale: string;
  label: string;
  hint: string;
  title: string;
  placeholder: string;
  suggestions: string[];
  paypalClientId: string | null;
}) {
  const [recommended, setRecommended] = useState<ShopDisplay | null>(null);
  const [cart, setCart] = useState<CartView[] | null>(null);
  return (
    <div className="space-y-6">
      {cart && <CartPanel carts={cart} onHide={() => setCart(null)} />}
      <ProductList listings={props.listings} recommended={recommended} onShowAll={() => setRecommended(null)} />
      <AskAi label={props.label} hint={props.hint}>
        <ChatPanel
          resumeKey={props.locale}
          title={props.title}
          placeholder={props.placeholder}
          suggestions={props.suggestions}
          paypalClientId={props.paypalClientId}
          onCart={(carts) => {
            setCart(carts);
            setRecommended(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onProducts={(shown) => {
            setRecommended(shown);
            setCart(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </AskAi>
    </div>
  );
}
