"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";
import { useI18n } from "@/components/i18n/I18nProvider";
import { type CaptureOutcome, PayPalButtons } from "@/components/PayPalButtons";
import { CountryStamp, ProductThumb } from "@/components/ui";
import { useBase } from "@/lib/use-base";

type Cart = {
  cart_id: string;
  seller: string;
  seller_country: string;
  currency: string;
  status: string;
  items: { listing_id: string; product_id: string; image_url: string | null; title: string; quantity: number; unit_price: Money; line_total: Money }[];
  total: Money;
};

const stepBtn =
  "inline-flex h-11 w-11 cursor-pointer items-center justify-center text-lg text-ink-2 transition-colors hover:bg-sheet-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

function Stepper({ title, quantity, busy, onChange }: { title: string; quantity: number; busy: boolean; onChange: (q: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-rule-strong bg-sheet" role="group" aria-label={t("cart.qty")}>
      <button type="button" className={stepBtn} disabled={busy} onClick={() => onChange(quantity - 1)} aria-label={t("cart.decrease", { title })}>
        <span aria-hidden>−</span>
      </button>
      <span className="num min-w-9 text-center text-sm font-semibold" aria-live="polite">
        {quantity}
      </span>
      <button type="button" className={stepBtn} disabled={busy} onClick={() => onChange(quantity + 1)} aria-label={t("cart.increase", { title })}>
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}

function Parcel({ cart, busy, paypalClientId, onQty, onPaid }: { cart: Cart; busy: boolean; paypalClientId: string | null; onQty: (listingId: string, q: number) => void; onPaid: (o: CaptureOutcome) => void }) {
  const { t } = useI18n();
  const count = cart.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <section aria-label={t("cart.parcel", { seller: cart.seller })} className="overflow-hidden rounded-[12px] border border-rule bg-sheet shadow-[var(--shadow-overlay)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-rule-strong px-5 py-3">
        <CountryStamp country={cart.seller_country} />
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">{cart.seller}</h2>
        <span className="ml-auto text-sm text-ink-3">
          {count === 1 ? t("cart.itemsOne") : t("cart.items", { n: count })} · {t("cart.paidIn", { currency: cart.currency })}
        </span>
      </header>

      <div className="grid bq-lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ul className="divide-y divide-rule px-5">
          {cart.items.map((i) => (
            <li key={i.listing_id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4 bq-sm:grid-cols-[auto_minmax(0,1fr)_auto_6rem]">
              <ProductThumb src={i.image_url} alt="" size={72} />
              <div className="min-w-0">
                <p className="font-medium leading-snug text-ink">{i.title}</p>
                <p className="num mt-0.5 text-sm text-ink-3">
                  {i.unit_price.display} {t("cart.each")}
                </p>
                <button type="button" disabled={busy} onClick={() => onQty(i.listing_id, 0)} className="-mb-2 mt-0.5 inline-flex min-h-11 cursor-pointer items-center text-sm text-ink-3 underline-offset-2 hover:text-alert-ink hover:underline disabled:opacity-50">
                  {t("cart.remove")}
                </button>
              </div>
              <div className="col-start-2 bq-sm:col-start-auto">
                <Stepper title={i.title} quantity={i.quantity} busy={busy} onChange={(q) => onQty(i.listing_id, q)} />
              </div>
              <p className="num col-start-2 font-display text-lg font-semibold bq-sm:col-start-auto bq-sm:text-right">{i.line_total.display}</p>
            </li>
          ))}
        </ul>

        <aside className="flex flex-col gap-4 border-t border-dashed border-rule-strong bg-sheet-2 px-5 py-5 bq-lg:border-t-0 bq-lg:border-l">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{t("cart.subtotal")}</dt>
              <dd className="num">{cart.total.display}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{t("cart.shipping")}</dt>
              <dd>{t("cart.included")}</dd>
            </div>
          </dl>
          <div className="flex items-baseline justify-between gap-3 border-t border-rule-strong pt-3">
            <span className="font-medium">{t("cart.total")}</span>
            <span className="num font-display text-3xl leading-none font-bold tracking-[-0.03em]">{cart.total.display}</span>
          </div>
          <PayPalButtons clientId={paypalClientId} currency={cart.currency} cartId={cart.cart_id} onPaid={onPaid} />
          <p className="text-xs leading-relaxed text-ink-3">{t("cart.protected")}</p>
        </aside>
      </div>
    </section>
  );
}

export function CartView({ paypalClientId, cancelled }: { paypalClientId: string | null; cancelled: boolean }) {
  const { t } = useI18n();
  const base = useBase();
  const [carts, setCarts] = useState<Cart[] | null>(null);
  const [paid, setPaid] = useState<CaptureOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ carts: Cart[] }>("/api/cart").then((r) => setCarts(r.carts)), []);
  useEffect(() => {
    void load().catch(() => setCarts([]));
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
    setBusy(true);
    try {
      const r = await api<{ carts: Cart[] }>("/api/cart", { method: "PATCH", body: { listing_id: listingId, quantity: Math.max(0, quantity) } });
      setCarts(r.carts);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cart.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] text-ink md:text-[2.4rem]">{t("cart.title")}</h1>
        <p className="mt-1 max-w-[60ch] text-ink-3">{t("cart.sub")}</p>
      </header>

      {cancelled && (
        <p role="status" className="rounded-md border border-gold-soft bg-gold-soft px-4 py-2.5 text-sm text-gold-ink">
          {t("cart.cancelled")}
        </p>
      )}
      {paid.map((o) => (
        <p key={o.order_id} role="status" className="rounded-md bg-positive-soft px-4 py-2.5 text-sm text-positive-ink">
          {t("cart.paid", { amount: o.total.display, status: o.order_status })}{" "}
          <Link href={`${base}/orders`} className="font-semibold underline">
            {t("cart.viewOrders")}
          </Link>
        </p>
      ))}
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft px-4 py-2.5 text-sm text-alert-ink">
          {error}
        </p>
      )}

      {carts === null && <div className="h-48 animate-pulse rounded-[12px] border border-rule bg-sheet-2" aria-hidden />}

      {carts?.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-[12px] border border-dashed border-rule-strong bg-sheet px-6 py-10">
          <h2 className="font-display text-xl font-semibold">{t("cart.empty.title")}</h2>
          <p className="max-w-[52ch] text-ink-3">{t("cart.empty.body")}</p>
          <Link href={`${base}/shop`} className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-accent px-5 font-semibold text-sheet transition-colors hover:brightness-95">
            {t("cart.empty.cta")}
          </Link>
        </div>
      )}

      {carts?.map((c) => (
        <Parcel key={c.cart_id} cart={c} busy={busy} paypalClientId={paypalClientId} onQty={setQty} onPaid={onPaid} />
      ))}

      {carts && carts.length > 0 && (
        <Link href={`${base}/shop`} className="w-fit cursor-pointer text-sm text-accent underline-offset-2 hover:underline">
          {t("cart.keepShopping")}
        </Link>
      )}
    </div>
  );
}
