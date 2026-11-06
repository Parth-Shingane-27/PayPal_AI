/**
 * Small visual primitives shared by pages, grids and the inbox. Server-safe
 * (no hooks) so they can render in Server Components and grid cells alike.
 */

export { CountryStamp, MarketStamp, Money, StatusStamp } from "./stamps";

export function ProductThumb({ src, alt, size = 36 }: { src: string | null | undefined; alt: string; size?: number }) {
  if (!src) return <span className="inline-block shrink-0 rounded-[3px] bg-sheet-2" style={{ width: size, height: size }} aria-hidden />;
  // Generated SVG art from /api/art; plain <img> keeps it simple and cacheable.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} loading="lazy" className="shrink-0 rounded-[3px] border border-rule" />;
}

export { Sparkline } from "./Sparkline";

/**
 * Where one sale's money went, as a single segmented bar:
 * net to maker, PayPal, platform, FX, refunds — chart slots 1-5 in fixed order.
 */
export function FeeBar({
  gross,
  parts,
  width = 128,
}: {
  gross: number;
  parts: { net: number; paypal: number; platform: number; fx: number; refund: number };
  width?: number;
}) {
  if (gross <= 0) return <span className="text-xs text-ink-3">No capture</span>;
  const segs = [
    { k: "net", v: Math.max(0, parts.net), fill: "var(--series-1)" },
    { k: "paypal", v: parts.paypal, fill: "var(--series-2)" },
    { k: "platform", v: parts.platform, fill: "var(--series-3)" },
    { k: "fx", v: parts.fx, fill: "var(--series-4)" },
    { k: "refund", v: parts.refund, fill: "var(--series-5)" },
  ];
  let x = 0;
  const pct = (v: number) => (v / gross) * 100;
  return (
    <svg width={width} height={10} viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={`${Math.round(pct(Math.max(0, parts.net)))}% reached the maker`}>
      <rect width="100" height="10" rx="1" fill="var(--sheet-2)" />
      {segs.map((s) => {
        const w = Math.max(0, Math.min(100 - x, pct(s.v)));
        // 1-unit surface gap between segments keeps adjacent fills distinct.
        const r = w > 0 ? <rect key={s.k} x={x} width={Math.max(0, w - (x + w < 99.5 ? 1 : 0))} height="10" fill={s.fill} /> : null;
        x += w;
        return r;
      })}
    </svg>
  );
}

/** Section heading used across dashboards: plain sentence-case title and optional aside. */
export function SectionHeading({ title, aside, id }: { title: string; aside?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 id={id} className="font-display text-xl font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {aside && <div className="text-sm text-ink-3">{aside}</div>}
    </div>
  );
}

export function Panel({ children, className = "", labelledBy }: { children: React.ReactNode; className?: string; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={`min-w-0 rounded-[10px] border border-rule bg-sheet p-4 md:p-5 ${className}`}>
      {children}
    </section>
  );
}
