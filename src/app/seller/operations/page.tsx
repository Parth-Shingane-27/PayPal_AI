import { parseDashboardPeriod } from "@/components/PeriodPicker";
import { OperationsView } from "./OperationsView";

export const metadata = { title: "Operations" };

export default async function OperationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <OperationsView period={parseDashboardPeriod(sp.period)} />;
}
