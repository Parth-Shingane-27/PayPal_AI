"use client";

import { useId, useState } from "react";

/**
 * Weekly trend line. Hover or focus shows a crosshair and that week's value;
 * the last point is always marked.
 */
export function Sparkline({ values, width = 96, height = 26, label, unit = "units" }: { values: number[]; width?: number; height?: number; label: string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId();
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [2 + i * step, height - 3 - (v / max) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const at = hover !== null ? pts[hover] : null;
  const weeksAgo = hover !== null ? values.length - 1 - hover : 0;
  return (
    <span className="relative inline-flex">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        className="overflow-visible"
        tabIndex={-1}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (values.length - 1));
          setHover(Math.max(0, Math.min(values.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L${(2 + (values.length - 1) * step).toFixed(1)} ${height - 2} L2 ${height - 2}Z`} fill={`url(#${gradient})`} />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {at && <line x1={at[0]} x2={at[0]} y1={0} y2={height} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="2 2" />}
        {(at ?? last) && <circle cx={(at ?? last)![0]} cy={(at ?? last)![1]} r={at ? 3 : 2.4} fill="var(--accent)" stroke="var(--sheet)" strokeWidth={at ? 1.5 : 0} />}
      </svg>
      {hover !== null && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 rounded-md border border-rule bg-sheet px-2 py-1 text-xs whitespace-nowrap text-ink shadow-[var(--shadow-overlay)]">
          <span className="num font-semibold">
            {values[hover]} {unit}
          </span>
          <span className="text-ink-3"> {weeksAgo === 0 ? "this week" : weeksAgo === 1 ? "last week" : `${weeksAgo} weeks ago`}</span>
        </span>
      )}
    </span>
  );
}
