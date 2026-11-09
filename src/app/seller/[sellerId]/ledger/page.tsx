import { parseDashboardPeriod } from "@/lib/periods";
import { LedgerView, type LedgerTab } from "./LedgerView";

export const metadata = { title: "Sales ledger" };

const TABS: LedgerTab[] = ["sales", "products", "buyers", "markets"];

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const period = parseDashboardPeriod(sp.period);
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = TABS.includes(tabParam as LedgerTab) ? (tabParam as LedgerTab) : "sales";
  return <LedgerView period={period} tab={tab} />;
}
