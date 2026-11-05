"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

type Account = { id: string; name: string; country: string; locale: string; currency?: string };

export default function LoginPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<{ sellers: Account[]; buyers: Account[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ sellers: Account[]; buyers: Account[] }>("/api/auth/demo-users")
      .then(setAccounts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load accounts."));
  }, []);

  async function login(role: "SELLER" | "BUYER", id: string) {
    try {
      const res = await api<{ redirect: string }>("/api/auth/demo", { body: { role, id } });
      router.push(res.redirect);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    }
  }

  const list = (role: "SELLER" | "BUYER", items: Account[]) => (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id}>
          <button className="w-full rounded border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-400" onClick={() => login(role, a.id)}>
            <span className="font-medium">{a.name}</span>
            <span className="ml-2 text-sm text-slate-500">
              {a.country} · {a.locale}
              {a.currency ? ` · ${a.currency}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">GlobalCart demo login</h1>
      <p className="mt-1 text-sm text-slate-600">Pick a seeded seller or buyer. Demo login is disabled in production unless DEMO_LOGIN=true.</p>
      {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {accounts && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section>
            <h2 className="mb-2 font-semibold">Sellers</h2>
            {list("SELLER", accounts.sellers)}
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Buyers</h2>
            {list("BUYER", accounts.buyers)}
          </section>
        </div>
      )}
    </main>
  );
}
