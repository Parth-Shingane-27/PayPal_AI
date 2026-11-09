"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type Money as MoneyT } from "@/components/api";
import { IconClose, IconMessages } from "@/components/icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import { RefundForm } from "@/components/RefundForm";
import { FeeBar, MarketStamp, Money, ProductThumb, StatusStamp } from "@/components/ui";
import { formatDate, shortId } from "@/lib/format";
import { useBase } from "@/lib/use-base";

type Details = {
  order_id: string;
  status: string;
  payments: {
    status: string;
    gross: MoneyT;
    paypal_fee: MoneyT | null;
    paypal_fee_is_estimate: boolean;
    platform_fee: MoneyT | null;
    fx_cost: MoneyT | null;
    net_to_seller: MoneyT | null;
    failure_reason: string | null;
    is_demo_seed_data: boolean;
  }[];
  refunds: { refund_id: string; status: string; reason: string; amount: MoneyT; seller_debit: MoneyT | null }[];
  payment_status: { still_refundable: MoneyT };
};

export type DrawerOrder = {
  order_id: string;
  date: string;
  status: string;
  buyer: string;
  market: string;
  items: string;
  image_url: string | null;
  gross: MoneyT;
  paypal_fee: MoneyT;
  platform_fee: MoneyT;
  fx_cost: MoneyT;
  net: MoneyT;
  conversation_id: string | null;
};

function Line({ label, value, tone, estimate }: { label: string; value: MoneyT | null | undefined; tone?: "fee" | "net"; estimate?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-ink-2">{label}</dt>
      <dd>
        <Money value={value} tone={tone} estimate={estimate} />
      </dd>
    </div>
  );
}

/** Side panel with the money trail for one order. Esc or the close button returns focus to the grid. */
export function OrderDrawer({ row, onClose, onChanged }: { row: DrawerOrder | null; onClose: () => void; onChanged?: () => void }) {
  const { t, locale } = useI18n();
  const base = useBase();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ id: string; details?: Details; error?: string } | null>(null);
  const current = row && result?.id === row.order_id ? result : null;
  const details = current?.details ?? null;
  const error = current?.error ?? null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!row) return;
    const id = row.order_id;
    api<Details>(`/api/orders/${id}`).then(
      (d) => setResult({ id, details: d }),
      (e: unknown) => setResult({ id, error: e instanceof Error ? e.message : t("ops.error") }),
    );
  }, [row, reload, t]);

  useEffect(() => {
    if (!row) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocus.current?.focus?.();
    };
  }, [row, onClose]);

  if (!row) return null;
  const paid = details?.payments.find((p) => p.status === "COMPLETED");
  const declined = details?.payments.filter((p) => p.status === "DECLINED") ?? [];

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button type="button" className="absolute inset-0 bg-ink/35" aria-label={t("drawer.closeDetails")} onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-[min(30rem,100vw)] flex-col overflow-y-auto bg-sheet shadow-[var(--shadow-overlay)]">
        <header className="flex items-start gap-3 border-b border-rule p-5">
          <ProductThumb src={row.image_url} alt="" size={52} />
          <div className="min-w-0 flex-1">
            <h2 id="drawer-title" className="font-display text-lg leading-snug font-semibold">
              {row.items}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
              <span>{row.buyer}</span>
              <MarketStamp locale={row.market} />
              <span className="num">{formatDate(row.date, locale)}</span>
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-sheet-2">
            <IconClose />
            <span className="sr-only">{t("drawer.close")}</span>
          </button>
        </header>

        <div className="flex flex-col gap-6 p-5">
          <div className="flex items-center justify-between">
            <StatusStamp status={row.status} />
            <span className="num text-xs text-ink-3">{t("drawer.order", { id: shortId(row.order_id) })}</span>
          </div>

          {error && <p className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">{error}</p>}
          {!details && !error && <p className="text-sm text-ink-3">{t("drawer.loading")}</p>}

          {paid && (
            <section aria-labelledby="trail">
              <h3 id="trail" className="mb-2 font-semibold">
                {t("drawer.trail")}
              </h3>
              <FeeBar
                gross={paid.gross.amount_minor}
                width={420}
                parts={{
                  net: row.net.amount_minor,
                  paypal: paid.paypal_fee?.amount_minor ?? 0,
                  platform: paid.platform_fee?.amount_minor ?? 0,
                  fx: paid.fx_cost?.amount_minor ?? 0,
                  refund: Math.max(0, (paid.net_to_seller?.amount_minor ?? 0) - row.net.amount_minor),
                }}
              />
              <dl className="mt-3 divide-y divide-rule text-sm">
                <Line label={t("drawer.paid")} value={paid.gross} />
                <Line label={t("drawer.paypal")} value={paid.paypal_fee} tone="fee" estimate={paid.paypal_fee_is_estimate} />
                <Line label={t("drawer.platform")} value={paid.platform_fee} tone="fee" />
                <Line label={t("drawer.fx")} value={paid.fx_cost} tone="fee" />
                <Line label={t("drawer.netCapture")} value={paid.net_to_seller} />
                <Line label={t("drawer.netAfter")} value={row.net} tone="net" />
              </dl>
            </section>
          )}

          {declined.length > 0 && (
            <section aria-labelledby="declined">
              <h3 id="declined" className="mb-2 font-semibold">
                {t("drawer.attempts")}
              </h3>
              <ul className="space-y-1 text-sm">
                {declined.map((p, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{t("drawer.attempt", { n: i + 1 })}</span>
                    <span className="text-ink-3">{p.failure_reason ?? t("drawer.noReason")}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-ink-3">{t("drawer.nothing")}</p>
            </section>
          )}

          {details && details.refunds.length > 0 && (
            <section aria-labelledby="refunds">
              <h3 id="refunds" className="mb-2 font-semibold">
                {t("drawer.refunds")}
              </h3>
              <ul className="space-y-3 text-sm">
                {details.refunds.map((r) => (
                  <li key={r.refund_id} className="rounded-md border border-rule p-3">
                    <div className="flex justify-between gap-3">
                      <Money value={r.amount} tone="fee" />
                      <span className="text-xs text-ink-3">{r.status.toLowerCase()}</span>
                    </div>
                    <p className="mt-1 text-ink-2">{r.reason}</p>
                    {r.seller_debit && <p className="mt-1 text-xs text-ink-3">{t("drawer.cost", { amount: r.seller_debit.display })}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {details && details.payment_status.still_refundable.amount_minor > 0 &&
            (paid?.is_demo_seed_data ? (
              <p className="rounded-md bg-sheet-2 p-3 text-sm text-ink-2">
                {t("drawer.seed", { amount: details.payment_status.still_refundable.display })}
              </p>
            ) : (
              <RefundForm
                key={`${details.order_id}-${details.payment_status.still_refundable.amount_minor}`}
                orderId={details.order_id}
                refundable={details.payment_status.still_refundable}
                onDone={() => {
                  setReload((n) => n + 1);
                  onChanged?.();
                }}
              />
            ))}

          {row.conversation_id && (
            <Link
              href={`${base}/messages?c=${row.conversation_id}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-rule-strong px-4 font-medium text-ink hover:border-accent hover:text-accent"
            >
              <IconMessages />
              {t("drawer.thread", { name: row.buyer })}
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}
