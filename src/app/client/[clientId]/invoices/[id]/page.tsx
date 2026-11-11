import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/gig/InvoiceDocument";
import { getT } from "@/lib/i18n/server";
import { clientPath, isUuid } from "@/lib/routes";
import { gigOwnerOf } from "@/server/auth";
import { AppError } from "@/server/errors";
import { clientPage } from "@/server/page-auth";
import { getInvoice } from "@/server/services/gig/invoices";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ clientId: string; id: string }> }) {
  const { clientId, id } = await params;
  const client = await clientPage(clientId);
  if (!isUuid(id)) notFound();
  let invoice: Awaited<ReturnType<typeof getInvoice>>;
  try {
    invoice = await getInvoice(gigOwnerOf(client), id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const t = await getT();
  const base = clientPath(client.clientId);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t("cl.proj.breadcrumb")} className="flex flex-wrap gap-4 print:hidden">
        <Link href={`${base}/invoices`} className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
          {t("cl.inv.back")}
        </Link>
        <Link href={`${base}/projects/${invoice.contract_id}`} className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
          {t("cl.inv.project")}
        </Link>
      </nav>
      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
