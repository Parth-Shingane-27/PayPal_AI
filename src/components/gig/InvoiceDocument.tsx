"use client";

import { useMemo } from "react";
import { isUiLang, translator, type UiLang } from "@/lib/i18n/core";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Money } from "../api";
import { useI18n } from "../i18n/I18nProvider";

/** What GET /api/invoices/<id> returns (invoiceView in server/services/gig/invoices.ts). */
export type InvoiceData = {
  invoice_id: string;
  number: string;
  issued_at: string;
  locale: string;
  currency: string;
  contract_id: string;
  milestone_id: string;
  from: { name: string; country: string };
  to: { name: string; company: string | null; tax_id: string | null };
  lines: { kind: "milestone" | "refund" | string; description: string; amount: Money }[];
  total: Money;
  note: string;
};

/**
 * A printable invoice. Its words follow the invoice's own language
 * (invoice.locale), not the viewer's, because it is a document sent to the
 * client; only the print button follows the viewer. Amounts are the API's
 * display strings. "Print / save as PDF" is hidden on paper, and the print CSS
 * in globals.css (".gig-invoice") prints only this sheet on A4.
 *
 *   <InvoiceDocument invoice={await api<InvoiceData>(`/api/invoices/${id}`)} />
 */
export function InvoiceDocument({ invoice, showPrintButton = true }: { invoice: InvoiceData; showPrintButton?: boolean }) {
  const viewer = useI18n();
  const lang: UiLang = useMemo(() => {
    const code = invoice.locale.slice(0, 2).toLowerCase();
    return isUiLang(code) ? code : "en";
  }, [invoice.locale]);
  const t = useMemo(() => translator(lang), [lang]);

  const issued = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(invoice.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(invoice.issued_at));
    } catch {
      return invoice.issued_at.slice(0, 10);
    }
  }, [invoice.locale, invoice.issued_at]);

  const countryKey = `country.${invoice.from.country}` as MessageKey;
  const country = t(countryKey) === countryKey ? invoice.from.country : t(countryKey);

  return (
    <div className="flex flex-col gap-3">
      {showPrintButton && (
        <div className="flex justify-end print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-10 items-center rounded-md border border-rule-strong bg-sheet px-4 text-sm font-medium text-ink-2 hover:bg-sheet-2 hover:text-ink"
          >
            {viewer.t("shared.inv.print")}
          </button>
        </div>
      )}

      <article lang={lang} aria-label={`${t("shared.inv.title")} ${invoice.number}`} className="gig-invoice mx-auto w-full max-w-[210mm] rounded-[10px] border border-rule bg-sheet p-6 text-ink md:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-rule-strong pb-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-ink-3 uppercase">GlobalGig</p>
            <h1 className="font-display mt-1 text-3xl font-bold tracking-[-0.02em]">{t("shared.inv.title")}</h1>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-3">{t("shared.inv.number")}</dt>
            <dd className="num font-semibold">{invoice.number}</dd>
            <dt className="text-ink-3">{t("shared.inv.issued")}</dt>
            <dd className="num">{issued}</dd>
            <dt className="text-ink-3">{t("col.currency")}</dt>
            <dd className="num">{invoice.currency}</dd>
          </dl>
        </header>

        <section className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">{t("shared.inv.from")}</h2>
            <p className="mt-1 font-semibold">{invoice.from.name}</p>
            <p className="text-ink-2">{country}</p>
          </div>
          <div>
            <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">{t("shared.inv.to")}</h2>
            <p className="mt-1 font-semibold">{invoice.to.company ?? invoice.to.name}</p>
            {invoice.to.company && <p className="text-ink-2">{invoice.to.name}</p>}
            {invoice.to.tax_id && (
              <p className="text-ink-2">
                {t("shared.inv.taxId")}: <span className="num">{invoice.to.tax_id}</span>
              </p>
            )}
          </div>
        </section>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule-strong text-left text-xs tracking-[0.06em] text-ink-3 uppercase">
              <th scope="col" className="py-2 pr-4 font-semibold">
                {t("shared.inv.description")}
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                {t("shared.inv.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-rule align-top">
                <td className="py-3 pr-4">
                  {l.kind === "refund" && <span className="mr-2 rounded-[3px] bg-sheet-2 px-1.5 py-0.5 text-xs font-semibold text-ink-2">{t("shared.inv.credit")}</span>}
                  {l.description}
                </td>
                <td className="num py-3 text-right whitespace-nowrap">{l.amount.display}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="pt-4 pr-4 text-left text-base font-semibold">
                {t("shared.inv.total")}
              </th>
              <td className="num pt-4 text-right text-lg font-bold whitespace-nowrap">{invoice.total.display}</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-8 border-t border-dashed border-rule-strong pt-4 text-xs text-ink-3">{t("shared.inv.noTax")}</p>
      </article>
    </div>
  );
}
