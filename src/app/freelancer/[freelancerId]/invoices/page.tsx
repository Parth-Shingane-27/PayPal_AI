import Link from "next/link";
import { localeOf } from "@/lib/i18n/core";
import { getT, getUiLang } from "@/lib/i18n/server";
import { freelancerPath } from "@/lib/routes";
import { freelancerPage } from "@/server/page-auth";
import { listInvoices } from "@/server/services/gig/invoices";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("fl.nav.invoices") };
}

export default async function InvoicesPage({ params }: { params: Promise<{ freelancerId: string }> }) {
  const { freelancerId } = await params;
  const f = await freelancerPage(freelancerId);
  const t = await getT();
  const uiLocale = localeOf(await getUiLang());
  const invoices = await listInvoices({ type: "FREELANCER", freelancerId: f.freelancerId, locale: f.locale }, { limit: 500 });
  const day = new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium" });
  const base = freelancerPath(f.freelancerId);

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("fl.nav.invoices")}</h1>
        <p className="mt-1 text-ink-3">{t("fl.inv.intro")}</p>
      </header>
      {invoices.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-rule-strong px-5 py-6 text-ink-3">{t("fl.inv.none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-rule bg-sheet">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">{t("fl.nav.invoices")}</caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs text-ink-3">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("shared.inv.number")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t("shared.inv.issued")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t("shared.led.col.client")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  {t("shared.inv.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.invoice_id} className="border-b border-rule last:border-0 hover:bg-sheet-2">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    <Link href={`${base}/invoices/${inv.invoice_id}`} className="num inline-flex min-h-10 items-center text-accent hover:underline">
                      {inv.number}
                    </Link>
                  </th>
                  <td className="num px-3 py-2 whitespace-nowrap text-ink-2">{day.format(new Date(inv.issued_at))}</td>
                  <td className="px-3 py-2">{inv.counterpart}</td>
                  <td className="num px-4 py-2 text-right font-semibold">{inv.total.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
