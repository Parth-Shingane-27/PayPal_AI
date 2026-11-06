import { PurchasesGrid } from "@/components/buyer/PurchasesGrid";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const t = await getT();
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("orders.title")}</h1>
        <p className="mt-1 max-w-2xl text-ink-3">{t("orders.intro")}</p>
      </header>
      <PurchasesGrid />
    </div>
  );
}
