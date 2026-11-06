"use client";

import { useState } from "react";
import { useT } from "../i18n/I18nProvider";

type Part = { key: string; label: string; bps: number; color: string };

/** "Where a $100 sale goes", with hover and keyboard tooltips on each segment. */
export function SaleWaybill({ bps, orders, makers }: { bps: { net: number; paypal: number; platform: number; fx: number; refunds: number }; orders: number; makers: number }) {
  const t = useT();
  const [active, setActive] = useState<string | null>(null);
  const parts: Part[] = [
    { key: "net", label: t("land.reaches"), bps: bps.net, color: "var(--series-1)" },
    { key: "paypal", label: t("anat.paypal"), bps: bps.paypal, color: "var(--series-2)" },
    { key: "platform", label: t("land.fee"), bps: bps.platform, color: "var(--series-3)" },
    { key: "fx", label: t("anat.fx"), bps: bps.fx, color: "var(--series-4)" },
    { key: "refunds", label: t("anat.refunds"), bps: bps.refunds, color: "var(--series-5)" },
  ];
  const dollars = (b: number) => `$${(b / 100).toFixed(2)}`;
  return (
    <figure className="relative rounded-[12px] border border-rule bg-sheet shadow-[var(--shadow-overlay)]">
      <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule-strong px-5 py-3">
        <figcaption className="font-display text-lg font-semibold">{t("land.waybill")}</figcaption>
        <span className="text-xs text-ink-3">{t("land.waybillOrders", { n: orders })}</span>
      </div>
      <div className="px-5 pt-6 pb-5">
        <div className="flex h-14 gap-[2px]" role="list" aria-label={t("land.waybill")}>
          {parts.map((p) => (
            <button
              key={p.key}
              type="button"
              role="listitem"
              className="fill-in relative h-full min-w-[4px] first:rounded-l-[6px] last:rounded-r-[6px]"
              style={{ width: `${p.bps / 100}%`, background: p.color, opacity: active && active !== p.key ? 0.4 : 1 }}
              onMouseEnter={() => setActive(p.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive(null)}
              aria-label={`${p.label}: ${dollars(p.bps)}`}
            >
              {active === p.key && (
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-md border border-rule bg-sheet px-3 py-2 text-left text-sm whitespace-nowrap text-ink shadow-[var(--shadow-overlay)]">
                  <span className="block font-semibold">{p.label}</span>
                  <span className="num">{t("land.ofEvery", { amount: dollars(p.bps) })}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {parts.map((p) => (
            <li
              key={p.key}
              className={`flex items-start gap-2 rounded-md px-1 py-0.5 transition-colors ${active === p.key ? "bg-sheet-2" : ""}`}
              onMouseEnter={() => setActive(p.key)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: p.color }} aria-hidden />
              <span>
                <span className="block text-sm text-ink-3">{p.label}</span>
                <span className="num block font-display text-lg font-semibold">{dollars(p.bps)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative flex items-center justify-between gap-4 rounded-b-[12px] bg-accent px-5 py-4 text-sheet">
        <span className="perforated absolute inset-x-0 -top-[4px] h-[7px]" aria-hidden />
        <span className="text-sm">{t("land.kept", { n: makers })}</span>
        <span className="num font-display text-4xl leading-none font-bold tracking-[-0.03em]">{(bps.net / 100).toFixed(0)}%</span>
      </div>
    </figure>
  );
}
