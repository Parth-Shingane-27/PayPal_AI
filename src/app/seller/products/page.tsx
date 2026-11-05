"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";

type Product = { id: string; sku: string; title: string; cost: Money; listings: { id: string; locale: string; status: string; price: Money }[] };

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "JPY"];
const LOCALES = ["en-US", "en-GB", "en-CA", "en-AU", "de-DE", "fr-FR", "es-ES", "it-IT", "es-MX", "ja-JP", "hi-IN"];

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ sku: "", title: "", description: "", source_locale: "en-US", cost: "", shipping: "", currency: "USD", margin: "30", attributes: "{}" });

  const load = useCallback(() => api<{ products: Product[] }>("/api/products").then((r) => setProducts(r.products)), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let attributes: unknown;
      try {
        attributes = JSON.parse(form.attributes || "{}");
      } catch {
        throw new Error("Attributes must be valid JSON.");
      }
      await api("/api/products", {
        body: {
          sku: form.sku,
          title: form.title,
          description: form.description,
          source_locale: form.source_locale,
          cost: form.cost,
          shipping: form.shipping,
          cost_currency: form.currency,
          margin_percent: form.margin,
          attributes,
        },
      });
      setForm({ ...form, sku: "", title: "", description: "", cost: "", shipping: "", attributes: "{}" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the product.");
    }
  }

  const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section>
        <h1 className="mb-3 text-xl font-semibold">Products</h1>
        <table className="w-full overflow-hidden rounded-lg bg-white text-sm shadow-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-2">Product</th>
              <th className="p-2">Cost + shipping</th>
              <th className="p-2">Listings</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="p-2">
                  <Link className="font-medium text-blue-700 hover:underline" href={`/seller/products/${p.id}`}>
                    {p.title}
                  </Link>
                  <div className="text-xs text-slate-500">{p.sku}</div>
                </td>
                <td className="p-2">{p.cost.display}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {p.listings.map((l) => (
                      <span key={l.id} className={`rounded px-1.5 py-0.5 text-xs ${l.status === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                        {l.locale} {l.price.display}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">New product</h2>
        <form className="space-y-2 rounded-lg bg-white p-4 shadow-sm" onSubmit={create}>
          <input className={input} placeholder="SKU" required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <input className={input} placeholder="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className={input} placeholder="Description" required rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={form.source_locale} onChange={(e) => setForm({ ...form, source_locale: e.target.value })}>
              {LOCALES.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select className={input} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input className={input} placeholder="Cost (e.g. 18.00)" required inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            <input className={input} placeholder="Shipping" inputMode="decimal" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} />
            <label className="col-span-2 flex items-center gap-2 text-sm">
              Target margin % <input className={input} inputMode="decimal" value={form.margin} onChange={(e) => setForm({ ...form, margin: e.target.value })} />
            </label>
          </div>
          <textarea className={`${input} font-mono`} rows={3} placeholder='Attributes JSON, e.g. {"material":"oak"}' value={form.attributes} onChange={(e) => setForm({ ...form, attributes: e.target.value })} />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white">Create</button>
        </form>
      </section>
    </div>
  );
}
