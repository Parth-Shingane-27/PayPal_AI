import { PeriodPicker } from "@/components/PeriodPicker";
import { getT } from "@/lib/i18n/server";
import { parseDashboardPeriod } from "@/lib/periods";
import { sellerPath } from "@/lib/routes";
import { TreasuryView } from "./TreasuryView";

export const metadata = { title: "Treasury" };

export default async function TreasuryPage({
  params,
  searchParams,
}: {
  params: Promise<{ sellerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sellerId } = await params;
  const period = parseDashboardPeriod((await searchParams).period);
  const t = await getT();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("tre.title")}</h1>
          <p className="mt-1 text-ink-3">{t("tre.intro")}</p>
        </div>
        <PeriodPicker current={period} basePath={sellerPath(sellerId, "treasury")} />
      </header>
      <TreasuryView period={period} />
    </div>
  );
}
