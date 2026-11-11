import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/gig/InvoiceDocument";
import { IconBack } from "@/components/icons";
import { getT } from "@/lib/i18n/server";
import { freelancerPath, isUuid } from "@/lib/routes";
import { AppError } from "@/server/errors";
import { freelancerPage } from "@/server/page-auth";
import { getInvoice } from "@/server/services/gig/invoices";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("shared.inv.title") };
}

export default async function InvoicePage({ params }: { params: Promise<{ freelancerId: string; id: string }> }) {
  const { freelancerId, id } = await params;
  const f = await freelancerPage(freelancerId);
  if (!isUuid(id)) notFound();
  const t = await getT();
  let invoice: Awaited<ReturnType<typeof getInvoice>>;
  try {
    invoice = await getInvoice({ type: "FREELANCER", freelancerId: f.freelancerId, locale: f.locale }, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <div className="flex flex-col gap-4">
      <Link href={freelancerPath(f.freelancerId, "invoices")} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-accent hover:underline print:hidden">
        <IconBack className="h-4 w-4" />
        {t("fl.nav.invoices")}
      </Link>
      <InvoiceDocument invoice={invoice} />
      <p className="text-sm text-ink-3 print:hidden">
        <Link href={freelancerPath(f.freelancerId, `projects/${invoice.contract_id}`)} className="text-accent hover:underline">
          {t("fl.inv.openProject")}
        </Link>
      </p>
    </div>
  );
}
