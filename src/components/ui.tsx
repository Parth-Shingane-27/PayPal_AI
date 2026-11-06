/**
 * Small visual primitives shared by pages, grids and the inbox. Server-safe
 * (no hooks) so they can render in Server Components and grid cells alike.
 */
import { COUNTRY_LABEL, LANGUAGE_OF, ORDER_STATUS_LABEL, type MoneyLike } from "@/lib/format";

/** Market as a postal stamp: bordered country code, language beside it. */
export function MarketStamp({ locale, showLanguage = true }: { locale: string; showLanguage?: boolean }) {
  const country = locale.slice(3) || locale;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${COUNTRY_LABEL[country] ?? country}, ${LANGUAGE_OF[locale] ?? locale}`}>
      <span className="inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-ink-3 px-1 text-[11px] font-bold tracking-wide text-ink-2">
        {country}
      </span>
      {showLanguage && <span className="text-ink-3">{LANGUAGE_OF[locale] ?? locale}</span>}
    </span>
  );
}

export function CountryStamp({ country }: { country: string }) {
  return (
    <span
      className="inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-ink-3 px-1 text-[11px] font-bold tracking-wide text-ink-2"
      title={COUNTRY_LABEL[country] ?? country}
    >
      {country}
    </span>
  );
}

const STATUS_STYLE: Record<string, { cls: string; mark: React.ReactNode }> = {
  PAID: { cls: "text-positive-ink bg-positive-soft", mark: <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" /> },
  PARTIALLY_REFUNDED: {
    cls: "text-gold-ink bg-gold-soft",
    mark: (
      <>
        <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1 9 9 1v8z" fill="currentColor" />
      </>
    ),
  },
  REFUNDED: { cls: "text-alert-ink bg-alert-soft", mark: <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /> },
  PENDING_PAYMENT: { cls: "text-ink-2 bg-sheet-2", mark: <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> },
};

/** Order status: shape + colour + words, never colour alone. */
export function StatusStamp({ status, label }: { status: string; label?: string }) {
  const s = STATUS_STYLE[status] ?? { cls: "text-ink-2 bg-sheet-2", mark: <circle cx="5" cy="5" r="3.5" fill="currentColor" /> };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
        {s.mark}
      </svg>
      {label ?? ORDER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Money({ value, tone, estimate }: { value: MoneyLike | null | undefined; tone?: "net" | "fee" | "muted"; estimate?: boolean }) {
  if (!value) return null;
  const color = tone === "net" ? "text-positive-ink font-semibold" : tone === "fee" ? "text-alert-ink" : tone === "muted" ? "text-ink-3" : "text-ink";
  const zero = value.amount_minor === 0;
  return (
    <span className={`num whitespace-nowrap ${zero ? "text-ink-3" : color}`}>
      {tone === "fee" && !zero ? "−" : ""}
      {value.display}
      {estimate && (
        <abbr title="Estimated fee from the fee table" className="ml-1 cursor-help text-gold no-underline">
          est.
        </abbr>
      )}
    </span>
  );
}

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
