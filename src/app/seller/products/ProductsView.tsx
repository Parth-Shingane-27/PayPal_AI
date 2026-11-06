"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type Money } from "@/components/api";
import { IconClose, IconSearch } from "@/components/icons";
import { ProductThumb, Sparkline } from "@/components/ui";
import { COUNTRY_LABEL, formatCount, LANGUAGE_OF } from "@/lib/format";

type Product = {
  id: string;
  sku: string;
  title: string;
  category: string | null;
  image_url: string | null;
  stock: number;
  rating: number | null;
  rating_count: number;
  source_locale: string;
  created_at: string;
  cost: Money;
  listings: { id: string; locale: string; status: string; price: Money }[];
};
type Perf = { product_id: string; units: number; orders: number; views: number; net_home: Money; weekly_units: number[] };

const MARKETS = ["en-US", "en-GB", "en-CA", "en-AU", "de-DE", "fr-FR", "es-ES", "it-IT", "es-MX", "ja-JP", "hi-IN"] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "JPY"];
type Sort = "newest" | "best" | "coverage" | "stock";
const SORT_LABEL: Record<Sort, string> = { newest: "Newest first", best: "Best selling", coverage: "Fewest markets", stock: "Lowest stock" };

/** 11 market slots: filled = published, dashed = draft, faint = not listed yet. */
function Coverage({ listings }: { listings: Product["listings"] }) {
  const by = new Map(listings.map((l) => [l.locale, l]));
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Markets">
      {MARKETS.map((m) => {
        const l = by.get(m);
        const country = m.slice(3);
        const state = !l ? "Not listed" : l.status === "PUBLISHED" ? `Published, ${l.price.display}` : l.status === "DRAFT" ? `Draft, ${l.price.display}` : "Archived";
        const cls = !l
          ? "border-rule text-ink-3/60"
          : l.status === "PUBLISHED"
            ? "border-accent bg-accent text-sheet"
            : l.status === "DRAFT"
              ? "border-dashed border-gold-ink text-gold-ink"
              : "border-rule text-ink-3 line-through";
        return (
          <li key={m}>
            <span
              title={`${COUNTRY_LABEL[country] ?? country} (${LANGUAGE_OF[m]}): ${state}`}
              className={`inline-flex h-6 min-w-8 items-center justify-center rounded-[3px] border-[1.5px] px-1 text-[11px] font-bold tracking-wide ${cls}`}
            >
              {country}
              <span className="sr-only">: {state}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ProductCard({ p, perf }: { p: Product; perf?: Perf }) {
  const published = p.listings.filter((l) => l.status === "PUBLISHED").length;
  const drafts = p.listings.filter((l) => l.status === "DRAFT").length;
  const missing = MARKETS.length - p.listings.length;
  return (
    <li className="group relative flex flex-col gap-4 rounded-[10px] border border-rule bg-sheet p-4 transition-colors hover:border-accent/60 focus-within:border-accent">
      <div className="flex gap-4">
        <span className="overflow-hidden rounded-[4px]">
          <span className="block transition-transform duration-200 group-hover:scale-[1.04]">
            <ProductThumb src={p.image_url} alt={p.title} size={84} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-snug font-semibold">
            <Link href={`/seller/products/${p.id}`} className="after:absolute after:inset-0 hover:text-accent">
              {p.title}
            </Link>
          </h2>
          <p className="mt-0.5 text-sm text-ink-3">
            {p.category ?? "Uncategorised"}, {p.sku}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            Cost with shipping <span className="num font-medium">{p.cost.display}</span>
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm text-ink-2">
          {published} of {MARKETS.length} markets live
          {drafts > 0 && <span className="text-gold-ink">, {drafts} draft{drafts > 1 ? "s" : ""} to review</span>}
        </p>
        <Coverage listings={p.listings} />
      </div>

      <dl className="grid grid-cols-3 gap-2 border-t border-rule pt-3 text-sm">
        <div>
          <dt className="text-ink-3">Sold, 30 days</dt>
          <dd className="num font-semibold">{perf ? formatCount(perf.units) : "–"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Earned</dt>
          <dd className="num font-semibold">{perf ? perf.net_home.display : "–"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Stock</dt>
          <dd className={`num font-semibold ${p.stock === 0 ? "text-alert" : p.stock < 10 ? "text-gold-ink" : ""}`}>{p.stock === 0 ? "Sold out" : p.stock}</dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-3">
        {perf ? <Sparkline values={perf.weekly_units} label={`Weekly units for ${p.title}`} width={120} /> : <span />}
        <span className="relative z-10 text-sm font-medium text-accent">
          {missing > 0 ? `Localize for ${missing} more` : drafts > 0 ? "Review drafts" : "Edit listings"}
        </span>
      </div>
    </li>
  );
}

function NewProductDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ sku: "", title: "", description: "", source_locale: "en-US", cost: "", shipping: "", currency: "USD", margin: "30", material: "", size: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const field = "min-h-11 w-full rounded-md border border-rule-strong bg-sheet px-3 text-ink placeholder:text-ink-3 focus:border-accent";
  const label = "flex flex-col gap-1 text-sm text-ink-2";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const attributes: Record<string, string> = {};
      if (form.material.trim()) attributes.material = form.material.trim();
      if (form.size.trim()) attributes.size = form.size.trim();
      await api("/api/products", {
        body: {
          sku: form.sku,
          title: form.title,
          description: form.description,
          source_locale: form.source_locale,
          cost: form.cost,
          shipping: form.shipping || "0",
          cost_currency: form.currency,
          margin_percent: form.margin,
          attributes,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The product could not be added.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <button type="button" className="absolute inset-0 bg-ink/35" aria-label="Close" onClick={onClose} />
      <form onSubmit={create} className="absolute inset-y-0 right-0 flex w-[min(32rem,100vw)] flex-col overflow-y-auto bg-sheet shadow-[var(--shadow-overlay)]">
        <header className="flex items-center justify-between border-b border-rule p-5">
          <h2 id={`${id}-title`} className="font-display text-xl font-semibold">
            Add a product
          </h2>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-sheet-2">
            <IconClose />
            <span className="sr-only">Close</span>
          </button>
        </header>
        <div className="flex flex-col gap-4 p-5">
          <p className="text-sm text-ink-3">Write it once in your own language. The Listing assistant then translates and prices it for each market as drafts you approve.</p>
          <label className={label}>
            Product name
            <input ref={first} className={field} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Hand-thrown stoneware mug" />
          </label>
          <label className={label}>
            Description
            <textarea className={`${field} py-2`} required rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it is, how it's made, size and care." />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              SKU
              <input className={field} required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="MUG-12OZ" />
            </label>
            <label className={label}>
              Written in
              <select className={field} value={form.source_locale} onChange={(e) => setForm({ ...form, source_locale: e.target.value })}>
                {MARKETS.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_OF[l]} ({l.slice(3)})
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Your cost
              <input className={`${field} num`} required inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="18.00" />
            </label>
            <label className={label}>
              Shipping cost
              <input className={`${field} num`} inputMode="decimal" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} placeholder="9.00" />
            </label>
            <label className={label}>
              Currency
              <select className={field} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              Target margin (%)
              <input className={`${field} num`} inputMode="decimal" value={form.margin} onChange={(e) => setForm({ ...form, margin: e.target.value })} />
            </label>
            <label className={label}>
              Material (optional)
              <input className={field} value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Stoneware" />
            </label>
            <label className={label}>
              Size (optional)
              <input className={field} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="12 oz" />
            </label>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
              {error}
            </p>
          )}
        </div>
        <footer className="mt-auto flex gap-3 border-t border-rule p-5">
          <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-md bg-accent px-4 font-semibold text-sheet hover:opacity-90 disabled:opacity-50">
            {busy ? "Adding…" : "Add product"}
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-rule-strong px-4 font-medium hover:bg-sheet-2">
            Cancel
          </button>
        </footer>
      </form>
    </div>
  );
}

export function ProductsView() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [perf, setPerf] = useState<Map<string, Perf>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<Sort>("newest");
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const searchId = useId();

  useEffect(() => {
    api<{ products: Product[] }>("/api/products").then(
      (r) => setProducts(r.products),
      (e: unknown) => setError(e instanceof Error ? e.message : "Products could not be loaded."),
    );
    api<{ rows: Perf[] }>("/api/analytics/seller/products?period=last_30_days").then(
      (r) => setPerf(new Map(r.rows.map((x) => [x.product_id, x]))),
      () => {},
    );
  }, [tick]);

  const categories = useMemo(() => ["All", ...Array.from(new Set((products ?? []).map((p) => p.category).filter((c): c is string => Boolean(c)))).sort()], [products]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (products ?? []).filter(
      (p) => (category === "All" || p.category === category) && (!q || `${p.title} ${p.sku} ${p.category ?? ""}`.toLowerCase().includes(q)),
    );
    const live = (p: Product) => p.listings.filter((l) => l.status === "PUBLISHED").length;
    return [...list].sort((a, b) =>
      sort === "best"
        ? (perf.get(b.id)?.units ?? 0) - (perf.get(a.id)?.units ?? 0)
        : sort === "coverage"
          ? live(a) - live(b)
          : sort === "stock"
            ? a.stock - b.stock
            : b.created_at.localeCompare(a.created_at),
    );
  }, [products, perf, query, category, sort]);

  const totals = useMemo(() => {
    const all = products ?? [];
    const live = all.reduce((s, p) => s + p.listings.filter((l) => l.status === "PUBLISHED").length, 0);
    const drafts = all.reduce((s, p) => s + p.listings.filter((l) => l.status === "DRAFT").length, 0);
    return { products: all.length, live, drafts, soldOut: all.filter((p) => p.stock === 0).length };
  }, [products]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">Products</h1>
          <p className="mt-1 text-ink-3">
            {products
              ? `${totals.products} products with ${totals.live} live listings${totals.drafts ? ` and ${totals.drafts} ${totals.drafts === 1 ? "draft" : "drafts"} to review` : ""}${totals.soldOut ? `. ${totals.soldOut} sold out` : ""}.`
              : "Loading your catalogue…"}
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="min-h-11 rounded-md bg-accent px-5 font-semibold text-sheet hover:opacity-90">
          Add a product
        </button>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={searchId} className="relative min-w-0 flex-1 basis-60">
            <span className="sr-only">Search products</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">
              <IconSearch className="h-4 w-4" />
            </span>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, SKU or category"
              className="min-h-11 w-full rounded-md border border-rule bg-sheet pr-3 pl-9 text-ink placeholder:text-ink-3 focus:border-accent"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-11 rounded-md border border-rule bg-sheet px-3 text-ink">
              {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`min-h-10 rounded-full border px-3.5 text-sm ${category === c ? "border-ink bg-ink font-semibold text-sheet" : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3" aria-label="Market key">
          <li className="inline-flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-[2px] bg-accent" aria-hidden /> Live
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-[2px] border-[1.5px] border-dashed border-gold-ink" aria-hidden /> Draft to review
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-[2px] border-[1.5px] border-rule" aria-hidden /> Not listed yet
          </li>
        </ul>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      {products && shown.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-rule-strong p-8 text-center">
          <p className="font-display text-lg">{products.length === 0 ? "No products yet" : "Nothing matches"}</p>
          <p className="mt-1 text-sm text-ink-3">{products.length === 0 ? "Add your first product, then let the Listing assistant localize it." : "Try another search or category."}</p>
        </div>
      )}
      {!products && !error && (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-72 rounded-[10px] border border-rule bg-sheet" />
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProductCard key={p.id} p={p} perf={perf.get(p.id)} />
          ))}
        </ul>
      )}

      {adding && (
        <NewProductDrawer
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
