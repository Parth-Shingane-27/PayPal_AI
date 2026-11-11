import Link from "next/link";
import { formatDate } from "@/lib/format";
import { localeOf } from "@/lib/i18n/core";
import { getT, getUiLang } from "@/lib/i18n/server";
import { clientPath } from "@/lib/routes";
import { gigOwnerOf } from "@/server/auth";
import { clientPage } from "@/server/page-auth";
import { listInvoices } from "@/server/services/gig/invoices";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ params }: { params: Promise<{ clientId: string }> }) {
  const client = await clientPage((await params).clientId);
  const base = clientPath(client.clientId);
  const t = await getT();
  const uiLocale = localeOf(await getUiLang());
  const invoices = await listInvoices(gigOwnerOf(client), { limit: 500 });
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("cl.inv.pageTitle")}</h1>
        <p className="mt-1 max-w-[65ch] text-ink-3">{t("cl.inv.intro")}</p>
      </header>
      {invoices.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-rule-strong bg-sheet px-6 py-10">
          <p className="max-w-[52ch] text-ink-3">{t("cl.inv.empty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-rule bg-sheet">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">{t("cl.inv.pageTitle")}</caption>
            <thead>
              <tr className="border-b border-rule-strong text-left text-xs tracking-[0.04em] text-ink-3 uppercase">
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  {t("shared.inv.number")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  {t("shared.inv.issued")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  {t("cl.inv.freelancer")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  {t("shared.inv.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.invoice_id} className="border-b border-rule last:border-b-0 hover:bg-sheet-2">
                  <th scope="row" className="px-4 py-1 text-left font-medium">
                    <Link href={`${base}/invoices/${i.invoice_id}`} className="num inline-flex min-h-11 items-center text-accent hover:underline">
                      {i.number}
                    </Link>
                  </th>
                  <td className="num px-4 py-1">{formatDate(i.issued_at, uiLocale)}</td>
                  <td className="px-4 py-1">{i.counterpart}</td>
                  <td className="num px-4 py-1 text-right font-semibold whitespace-nowrap">{i.total.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
