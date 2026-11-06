"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./api";

type Market = { locale: string; language: string; currency: string; country: string };

/** The buyer's market and language; stored in the signed session cookie. */
export function MarketPicker({ current }: { current: string }) {
  const router = useRouter();
  const [markets, setMarkets] = useState<Market[]>([]);
  useEffect(() => {
    void api<{ markets: Market[] }>("/api/markets").then((r) => setMarkets(r.markets));
  }, []);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Shopping in</span>
      <select
        className="min-h-11 rounded-md border border-rule-strong bg-sheet px-2 py-1 text-ink md:min-h-9"
        value={current}
        onChange={async (e) => {
          await api("/api/me/market", { body: { locale: e.target.value } });
          router.refresh();
        }}
      >
        {markets.map((m) => (
          <option key={m.locale} value={m.locale}>
            {m.language} ({m.country}), {m.currency}
          </option>
        ))}
      </select>
    </label>
  );
}
