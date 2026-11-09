"use client";

import type { MoneyLike } from "@/lib/format";
import { useI18n } from "../i18n/I18nProvider";

export type CapCard = {
  currency: string;
  earned: MoneyLike;
  refunded: MoneyLike;
  paid_out: MoneyLike;
  reserved: MoneyLike;
  available: MoneyLike;
  fee_cap_threshold: MoneyLike;
  until_cap: MoneyLike;
  cap_reached: boolean;
  payout_amount: MoneyLike;
  estimated_payout_fee: MoneyLike;
  readiness_bps: number;
};

/** Fixed colours: money already gone is neutral, refunds keep their chart colour, what is left to take is the "kept" blue. */
const SEGMENTS = [
  { key: "paid_out", label: "tre.paidOut", color: "var(--ink-3)" },
  { key: "refunded", label: "tre.refunded", color: "var(--series-5)" },
  { key: "reserved", label: "tre.reserved", color: "var(--series-4)" },
  { key: "available", label: "tre.available", color: "var(--series-1)" },
] as const;

/**
 * Where one currency's money is, as a single bar: paid out, refunded, reserved
 * and available. The notch marks how much available money makes one payout's
 * fee stop growing, measured from the start of the available segment, so the
 * available segment reaching the notch means "this is the cheap moment to pay out".
 */
export function CapGauge({ card }: { card: CapCard }) {
  const { t } = useI18n();
  const start = card.paid_out.amount_minor + card.refunded.amount_minor + card.reserved.amount_minor;
  const available = Math.max(0, card.available.amount_minor);
  const notchAt = start + card.fee_cap_threshold.amount_minor;
  const scale = Math.max(start + available, notchAt, 1);
  const pct = (minor: number) => `${(Math.max(0, minor) / scale) * 100}%`;
  return (
    <div>
      <div className="relative py-1.5" aria-hidden>
        <div className="flex h-3.5 gap-px overflow-hidden rounded-[4px] bg-sheet-2">
          {SEGMENTS.map((s) => {
            const amount = s.key === "available" ? available : card[s.key].amount_minor;
            return amount > 0 ? <span key={s.key} className="h-full min-w-[3px]" style={{ width: pct(amount), background: s.color }} /> : null;
          })}
        </div>
        <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: pct(notchAt) }} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {SEGMENTS.map((s) => (
          <div key={s.key} className="flex items-baseline gap-2">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 self-start rounded-[2px]" style={{ background: s.color }} aria-hidden />
            <dt className="text-ink-3">{t(s.label)}</dt>
            <dd className="num ml-auto font-medium text-ink">{card[s.key].display}</dd>
          </div>
        ))}
        <div className="col-span-2 flex items-baseline gap-2">
          <span className="h-3 w-0.5 shrink-0 self-center rounded-full bg-ink" aria-hidden />
          <dt className="text-ink-3">{t("tre.capAt")}</dt>
          <dd className="num ml-auto font-medium text-ink">{card.fee_cap_threshold.display}</dd>
        </div>
      </dl>
    </div>
  );
}
