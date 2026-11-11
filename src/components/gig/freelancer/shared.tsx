"use client";

/** Small pieces shared by the freelancer workspace pages. */
import type { Money } from "@/components/api";

export type { Money };

/** Every market a service page can be written for (same list as server/domain/markets). */
export const MARKETS = ["en-US", "en-GB", "en-CA", "en-AU", "de-DE", "fr-FR", "es-ES", "it-IT", "es-MX", "ja-JP", "hi-IN"] as const;

/** The currency clients pay in, per market (same as server/domain/markets). */
export const MARKET_CURRENCY: Record<string, string> = {
  "en-US": "USD",
  "en-GB": "GBP",
  "en-CA": "CAD",
  "en-AU": "AUD",
  "de-DE": "EUR",
  "fr-FR": "EUR",
  "es-ES": "EUR",
  "it-IT": "EUR",
  "es-MX": "MXN",
  "ja-JP": "JPY",
  "hi-IN": "USD",
};

export const btn = "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50";
export const primaryBtn = `${btn} bg-accent font-semibold text-sheet hover:brightness-95`;
export const secondaryBtn = `${btn} border border-rule-strong font-medium text-ink-2 hover:bg-sheet-2 hover:text-ink`;
export const field = "min-h-11 w-full rounded-md border border-rule-strong bg-sheet px-3 text-ink placeholder:text-ink-3 focus:border-accent";
export const labelCls = "flex flex-col gap-1 text-sm text-ink-2";
export const h1Cls = "font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]";
export const h2Cls = "font-display text-xl font-semibold tracking-[-0.01em]";

export const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function Notice({ tone, children }: { tone: "ok" | "error" | "info"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-positive-soft text-positive-ink" : tone === "error" ? "bg-alert-soft text-alert-ink" : "bg-sheet-2 text-ink-2";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-md px-4 py-2.5 text-sm ${cls}`}>
      {children}
    </p>
  );
}

/** A date (ISO string or yyyy-mm-dd) in the viewer's language. */
export function dateText(iso: string | null | undefined, locale: string, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium", timeZone: iso.length === 10 ? "UTC" : undefined }).format(d);
}

export function Skeleton({ h = "h-40" }: { h?: string }) {
  return <div className={`${h} animate-pulse rounded-[10px] border border-rule bg-sheet-2`} aria-hidden />;
}
