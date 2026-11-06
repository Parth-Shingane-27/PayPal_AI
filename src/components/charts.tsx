"use client";

import { useState } from "react";
import { formatBps, type MoneyLike } from "@/lib/format";

/**
 * Hand-rolled charts (no chart library). Colours come from the validated
 * --series-* slots; text always uses ink tokens. Each chart has a hover/focus
 * tooltip and a visually hidden table.
 */

// --- Fee anatomy: the waybill strip ---------------------------------------------------

type Anatomy = { gross: MoneyLike; paypal_fees: MoneyLike; platform_fees: MoneyLike; fx_costs: MoneyLike; refunds: MoneyLike; net: MoneyLike; kept_bps: number };

const ANATOMY_PARTS = [
  { key: "net", label: "Reached you", color: "var(--series-1)" },
  { key: "paypal_fees", label: "PayPal fees", color: "var(--series-2)" },
  { key: "platform_fees", label: "Platform fee", color: "var(--series-3)" },
  { key: "fx_costs", label: "Currency conversion", color: "var(--series-4)" },
  { key: "refunds", label: "Refunds", color: "var(--series-5)" },
] as const;

export function FeeAnatomy({ data, periodLabel }: { data: Anatomy; periodLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  const gross = data.gross.amount_minor;
  const parts = ANATOMY_PARTS.map((p) => ({ ...p, value: data[p.key] as MoneyLike })).filter((p) => p.value.amount_minor > 0);
  return (
    <section aria-labelledby="anatomy-title" className="relative overflow-hidden rounded-[10px] border border-rule bg-sheet">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_13.5rem]">
        <div className="p-4 md:p-6">
          <h2 id="anatomy-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
            Where every sale went
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            {data.gross.display} in sales, {periodLabel}. Hover or tab through the strip for each amount.
          </p>
          <div className="mt-5 flex h-11 w-full gap-[2px]" role="list" aria-label="Breakdown of sales">
            {gross > 0 ? (
              parts.map((p) => {
                const share = (p.value.amount_minor / gross) * 100;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="listitem"
                    className="fill-in relative h-full min-w-[3px] rounded-[2px] outline-offset-2 first:rounded-l-[4px] last:rounded-r-[4px]"
                    style={{ width: `${share}%`, background: p.color, opacity: active && active !== p.key ? 0.45 : 1 }}
                    onMouseEnter={() => setActive(p.key)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(p.key)}
                    onBlur={() => setActive(null)}
                    aria-label={`${p.label}: ${p.value.display}, ${share.toFixed(1)}%`}
                  >
                    {active === p.key && (
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-rule bg-sheet px-2.5 py-1.5 text-left text-xs text-ink shadow-[var(--shadow-overlay)]">
                        <span className="block font-semibold">{p.label}</span>
                        <span className="num">
                          {p.value.display}, {share.toFixed(1)}%
                        </span>
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-[4px] bg-sheet-2 text-sm text-ink-3">No captured sales in this period.</div>
            )}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {ANATOMY_PARTS.map((p) => {
              const v = data[p.key] as MoneyLike;
              return (
                <li
                  key={p.key}
                  className={`flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 transition-colors ${active === p.key ? "bg-sheet-2" : ""} ${active && active !== p.key ? "opacity-55" : ""}`}
                  onMouseEnter={() => setActive(p.key)}
                  onMouseLeave={() => setActive(null)}
                >
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: p.color }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-ink-3">{p.label}</span>
                    <span className="num block font-semibold text-ink">{v.display}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {/* The stub: what the maker kept, torn off along a perforation. */}
        <div className="relative flex flex-col justify-center border-t border-dashed border-rule-strong bg-accent-soft px-6 py-5 md:border-t-0 md:border-l">
          <span className="perforated absolute inset-x-0 -top-[4px] h-[7px] md:hidden" aria-hidden />
          <p className="text-sm text-accent-ink">You kept</p>
          <p className="num font-display text-[3.25rem] leading-none font-bold tracking-[-0.03em] text-accent-ink [font-stretch:85%]">{formatBps(data.kept_bps, 0)}</p>
          <p className="mt-2 text-sm text-accent-ink">
            of every sale: <span className="num font-semibold">{data.net.display}</span>
          </p>
        </div>
      </div>
      <table className="sr-only-table">
        <caption>Where sales went</caption>
        <tbody>
          {ANATOMY_PARTS.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{(data[p.key] as MoneyLike).display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
