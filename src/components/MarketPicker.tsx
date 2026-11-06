"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/lib/i18n/messages";
import { api } from "./api";
import { useT } from "./i18n/I18nProvider";

type Market = { locale: string; language: string; currency: string; country: string };

/** The buyer's market and language; stored in the signed session cookie. */
export function MarketPicker({ current }: { current: string }) {
  const router = useRouter();
  const t = useT();
  const [markets, setMarkets] = useState<Market[]>([]);
  useEffect(() => {
    void api<{ markets: Market[] }>("/api/markets").then((r) => setMarkets(r.markets));
  }, []);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("market.label")}</span>
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
            {t(`langname.${m.locale.slice(0, 2)}` as MessageKey)} ({m.country}), {m.currency}
          </option>
        ))}
      </select>
    </label>
  );
}
