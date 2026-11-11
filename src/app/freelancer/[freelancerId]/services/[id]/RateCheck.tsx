"use client";

import { useState } from "react";
import { api, type Money } from "@/components/api";
import { errText, h2Cls, MARKETS, Notice, primaryBtn, secondaryBtn } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { IconCheck } from "@/components/icons";
import { MarketStamp } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/messages";

const POSITIONINGS = ["competitive", "market", "premium"] as const;
type Positioning = (typeof POSITIONINGS)[number];

type Research =
  | {
      market: string;
      cached: boolean;
      result: {
        currency: string;
        unit: "project" | "hour";
        researched_at: string;
        stats: { count: number } | null;
        range: { low: Money; p25: Money; median: Money; p75: Money; high: Money } | null;
        web: { status: "ok" | "no_offers" | "failed"; error: string | null };
      };
    }
  | { market: string; error: string };
type Quote =
  | {
      market: string;
      unit: "hour" | "package";
      items: { tier: string | null; suggested_price: Money; floor_price: Money; estimated_net_to_you: Money; market_position: { position: string } | null }[];
      warnings: { code: string; message: string }[];
    }
  | { market: string; error: string };
type Row = { research: Research | null; quotes: Partial<Record<Positioning, Quote>>; error?: string };

const MAX_MARKETS = 6;

/**
 * "Check market rates": for the chosen markets, what comparable services cost
 * there (range from the research) and the suggested price per package at each
 * positioning. Prices come from the server (never below the hourly floor);
 * applying one is done by the Profile assistant or by editing the page.
 */
export function RateCheck({ serviceId }: { serviceId: string }) {
  const { t, locale } = useI18n();
  const [chosen, setChosen] = useState<string[]>([]);
  const [rows, setRows] = useState<Map<string, Row>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const toggle = (m: string) => setChosen((c) => (c.includes(m) ? c.filter((x) => x !== m) : c.length >= MAX_MARKETS ? c : [...c, m]));
  const running = busy.size > 0;

  async function checkOne(market: string, refresh: boolean) {
    const call = (positioning: Positioning, again: boolean) =>
      api<{ research: Research[]; quotes: Quote[] }>(`/api/services/${serviceId}/rates`, { body: { markets: [market], refresh: again, positioning } });
    try {
      // The first call researches (or reuses research from the last 24 h); the other two reuse it.
      const first = await call("market", refresh);
      const row: Row = { research: first.research[0] ?? null, quotes: { market: first.quotes[0] } };
      setRows((prev) => new Map(prev).set(market, row));
      const others = await Promise.all((["competitive", "premium"] as const).map((p) => call(p, false).then((r) => [p, r.quotes[0]] as const)));
      for (const [p, q] of others) row.quotes[p] = q;
      setRows((prev) => new Map(prev).set(market, { ...row }));
    } catch (e) {
      setRows((prev) => new Map(prev).set(market, { research: null, quotes: {}, error: errText(e, t("fl.rates.failed")) }));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(market);
        return next;
      });
    }
  }

  async function run(refresh: boolean) {
    setError(null);
    const queue = [...chosen];
    setBusy(new Set(queue));
    const worker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) await checkOne(m, refresh);
    };
    try {
      await Promise.all([worker(), worker()]);
    } catch (e) {
      setError(errText(e, t("fl.rates.failed")));
    }
  }

  const shown = MARKETS.filter((m) => rows.has(m) || busy.has(m));

  return (
    <section aria-labelledby="rates-title" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <h2 id="rates-title" className={h2Cls}>
        {t("fl.rates.title")}
      </h2>
      <p className="mt-1 max-w-[70ch] text-ink-3">{t("fl.rates.intro")}</p>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm text-ink-2">{t("fl.rates.pick", { n: MAX_MARKETS })}</legend>
        <div className="flex flex-wrap gap-2">
          {MARKETS.map((m) => {
            const on = chosen.includes(m);
            return (
              <label key={m} className="cursor-pointer">
                <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(m)} disabled={running || (!on && chosen.length >= MAX_MARKETS)} />
                <span
                  className={`flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] peer-disabled:opacity-60 ${
                    on ? "border-accent bg-accent-soft text-ink" : "border-rule-strong bg-sheet text-ink-2 hover:border-ink-3 hover:bg-sheet-2"
                  }`}
                >
                  {on && <IconCheck className="h-4 w-4 text-accent" />}
                  <MarketStamp locale={m} />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={primaryBtn} disabled={running || chosen.length === 0} onClick={() => void run(false)}>
          {running ? t("fl.rates.checking", { n: busy.size }) : t("fl.rates.check")}
        </button>
        <button type="button" className={secondaryBtn} disabled={running || chosen.length === 0} onClick={() => void run(true)} title={t("fl.rates.refreshHint")}>
          {t("fl.rates.refresh")}
        </button>
      </div>
      {running && <p className="mt-2 text-xs text-ink-3">{t("fl.rates.slow")}</p>}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {shown.map((m) => {
            const row = rows.get(m);
            if (!row || (busy.has(m) && !row.research)) {
              return (
                <li key={m} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm text-ink-3">
                  <MarketStamp locale={m} /> {t("fl.rates.searching")}
                </li>
              );
            }
            if (row.error || !row.research || "error" in row.research) {
              return (
                <li key={m} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <MarketStamp locale={m} />
                  <span className="text-alert-ink">{row.error ?? (row.research && "error" in row.research ? row.research.error : t("fl.rates.failed"))}</span>
                </li>
              );
            }
            const r = row.research.result;
            const base = row.quotes.market;
            const items = base && !("error" in base) ? base.items : [];
            return (
              <li key={m} className="rounded-md border border-rule p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <MarketStamp locale={m} />
                    <p className="mt-1 text-xs text-ink-3">{t("fl.rates.checkedOn", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(r.researched_at)) })}</p>
                  </div>
                  <div className="text-sm">
                    {r.range ? (
                      <>
                        <p>
                          <span className="text-ink-3">{r.unit === "hour" ? t("fl.rates.rangeHour") : t("fl.rates.rangeProject")}: </span>
                          <span className="num whitespace-nowrap">
                            {r.range.low.display} – <strong>{r.range.median.display}</strong> – {r.range.high.display}
                          </span>
                        </p>
                        <p className="text-xs text-ink-3">{t("fl.rates.comparables", { n: r.stats?.count ?? 0 })}</p>
                      </>
                    ) : (
                      <p className="text-ink-3">{r.web.status === "failed" ? t("fl.rates.searchFailed", { error: r.web.error ?? "" }) : t("fl.rates.noComparables")}</p>
                    )}
                  </div>
                </div>
                {items.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-sm">
                      <thead className="border-b border-rule text-xs text-ink-3">
                        <tr>
                          <th scope="col" className="py-1.5 pr-3 font-medium">
                            {t("fl.rates.package")}
                          </th>
                          <th scope="col" className="py-1.5 pr-3 font-medium">
                            {t("fl.svc.floor")}
                          </th>
                          {POSITIONINGS.map((p) => (
                            <th key={p} scope="col" className="py-1.5 pr-3 font-medium">
                              {t(`fl.pos.${p}` as MessageKey)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, i) => (
                          <tr key={it.tier ?? i} className="border-b border-rule last:border-0">
                            <th scope="row" className="py-2 pr-3 text-left font-medium">
                              {it.tier ? t(`fl.tier.${it.tier}` as MessageKey) : t("fl.svc.hourlyRate")}
                            </th>
                            <td className="num py-2 pr-3 text-ink-3">{it.floor_price.display}</td>
                            {POSITIONINGS.map((p) => {
                              const q = row.quotes[p];
                              const item = q && !("error" in q) ? q.items[i] : null;
                              return (
                                <td key={p} className="num py-2 pr-3">
                                  {item ? (
                                    <>
                                      <span className="font-semibold">{item.suggested_price.display}</span>
                                      <span className="block text-xs text-ink-3">{t("fl.rates.net", { amount: item.estimated_net_to_you.display })}</span>
                                    </>
                                  ) : q && "error" in q ? (
                                    <span className="text-xs text-alert-ink">{q.error}</span>
                                  ) : (
                                    <span className="text-ink-3">…</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {base && !("error" in base) &&
                  base.warnings
                    .filter((w) => w.code !== "NO_MARKET_DATA" || !r.range)
                    .map((w) => (
                      <p key={w.code} role="note" className="mt-2 rounded-md bg-gold-soft px-3 py-1.5 text-xs text-gold-ink">
                        {w.message}
                      </p>
                    ))}
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > 0 && <p className="mt-3 text-xs text-ink-3">{t("fl.rates.note")}</p>}
    </section>
  );
}
