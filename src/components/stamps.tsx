"use client";

/** Stamps, status seals and money cells. Client components so their words follow the chosen language. */
import type { MessageKey } from "@/lib/i18n/messages";
import type { MoneyLike } from "@/lib/format";
import { useT } from "./i18n/I18nProvider";

const STATUS_KEYS = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "PENDING_PAYMENT"];

/** Market as a postal stamp: bordered country code, language beside it. */
export function MarketStamp({ locale, showLanguage = true }: { locale: string; showLanguage?: boolean }) {
  const t = useT();
  const country = locale.slice(3) || locale;
  const lang = t(`langname.${locale.slice(0, 2)}` as MessageKey);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${t(`country.${country}` as MessageKey)}, ${lang}`}>
      <span className="inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-ink-3 px-1 text-[11px] font-bold tracking-wide text-ink-2">
        {country}
      </span>
      {showLanguage && <span className="text-ink-3">{lang}</span>}
    </span>
  );
}

export function CountryStamp({ country }: { country: string }) {
  const t = useT();
  return (
    <span
      className="inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-[3px] border-[1.5px] border-dashed border-ink-3 px-1 text-[11px] font-bold tracking-wide text-ink-2"
      title={t(`country.${country}` as MessageKey)}
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
  const t = useT();
  const s = STATUS_STYLE[status] ?? { cls: "text-ink-2 bg-sheet-2", mark: <circle cx="5" cy="5" r="3.5" fill="currentColor" /> };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
        {s.mark}
      </svg>
      {label ?? (STATUS_KEYS.includes(status) ? t(`status.${status}` as MessageKey) : status)}
    </span>
  );
}

export function Money({ value, tone, estimate }: { value: MoneyLike | null | undefined; tone?: "net" | "fee" | "muted"; estimate?: boolean }) {
  const t = useT();
  if (!value) return null;
  const color = tone === "net" ? "text-positive-ink font-semibold" : tone === "fee" ? "text-alert-ink" : tone === "muted" ? "text-ink-3" : "text-ink";
  const zero = value.amount_minor === 0;
  return (
    <span className={`num whitespace-nowrap ${zero ? "text-ink-3" : color}`}>
      {tone === "fee" && !zero ? "−" : ""}
      {value.display}
      {estimate && (
        <abbr title={t("cell.estTitle")} className="ml-1 cursor-help text-gold-ink no-underline">
          {t("cell.est")}
        </abbr>
      )}
    </span>
  );
}

