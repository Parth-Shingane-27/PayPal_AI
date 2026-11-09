"use client";

import { useId, useState } from "react";
import { useI18n } from "./i18n/I18nProvider";

/**
 * Weekly trend line. Hover, or focus and the arrow keys, shows a crosshair and
 * that week's value. The last point is always marked and its value is printed
 * beside the line; the highest and lowest weeks get hollow markers, so the
 * shape can be read without hovering.
 */
export function Sparkline({
  values,
  width = 96,
  height = 26,
  label,
  unit,
  showValue = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
  unit?: string;
  showValue?: boolean;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId();
  const unitLabel = unit ?? t("spark.units");
  const max = Math.max(1, ...values);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [2 + i * step, height - 3 - (v / max) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const lastIndex = values.length - 1;
  const last = pts[lastIndex];
  const at = hover !== null ? pts[hover] : null;
  const weeksAgo = hover !== null ? lastIndex - hover : 0;
  // Hollow markers for the extremes, only when the line actually varies and they are not the last point.
  const extremes = hi === lo ? [] : [values.indexOf(hi), values.indexOf(lo)].filter((i) => i !== lastIndex);
  const lastValue = values[lastIndex] ?? 0;
  const summary = t("spark.summary", { label, value: lastValue, unit: unitLabel, min: lo, max: hi });
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={summary}
          className="overflow-visible rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
          tabIndex={0}
          onFocus={() => setHover(lastIndex)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? lastIndex) - 1));
            else if (e.key === "ArrowRight") setHover((h) => Math.min(lastIndex, (h ?? lastIndex) + 1));
            else if (e.key === "Escape") setHover(null);
            else return;
            e.preventDefault();
          }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left) / r.width) * lastIndex);
            setHover(Math.max(0, Math.min(lastIndex, i)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--series-1)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${(2 + lastIndex * step).toFixed(1)} ${height - 2} L2 ${height - 2}Z`} fill={`url(#${gradient})`} />
          <path d={d} fill="none" stroke="var(--series-1)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          {extremes.map((i) => (
            <circle key={i} cx={pts[i]![0]} cy={pts[i]![1]} r={2.2} fill="var(--sheet)" stroke="var(--series-1)" strokeWidth="1.2" />
          ))}
          {at && <line x1={at[0]} x2={at[0]} y1={0} y2={height} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="2 2" />}
          {(at ?? last) && <circle cx={(at ?? last)![0]} cy={(at ?? last)![1]} r={at ? 3 : 2.4} fill="var(--series-1)" stroke="var(--sheet)" strokeWidth={at ? 1.5 : 0} />}
        </svg>
        {hover !== null && (
          <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 rounded-md border border-rule bg-sheet px-2 py-1 text-xs whitespace-nowrap text-ink shadow-[var(--shadow-overlay)]">
            <span className="num font-semibold">
              {values[hover]} {unitLabel}
            </span>
            <span className="text-ink-3"> {weeksAgo === 0 ? t("spark.thisWeek") : weeksAgo === 1 ? t("spark.lastWeek") : t("spark.weeksAgo", { n: weeksAgo })}</span>
          </span>
        )}
      </span>
      {showValue && (
        <span className="num text-xs font-semibold text-ink-2" aria-hidden>
          {lastValue}
        </span>
      )}
    </span>
  );
}
