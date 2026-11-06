import Link from "next/link";

export const DASHBOARD_PERIODS = [
  { key: "last_30_days", label: "30 days" },
  { key: "last_90_days", label: "90 days" },
  { key: "year_to_date", label: "Year to date" },
  { key: "all_time", label: "All time" },
] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]["key"];

export function parseDashboardPeriod(v: string | string[] | undefined): DashboardPeriod {
  const s = Array.isArray(v) ? v[0] : v;
  return DASHBOARD_PERIODS.some((p) => p.key === s) ? (s as DashboardPeriod) : "last_90_days";
}

/** Segmented period links; plain navigation so the server re-renders the figures. */
export function PeriodPicker({ current, basePath }: { current: DashboardPeriod; basePath: string }) {
  return (
    <nav aria-label="Period" className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
      {DASHBOARD_PERIODS.map((p) => {
        const active = p.key === current;
        return (
          <Link
            key={p.key}
            href={`${basePath}?period=${p.key}`}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={`inline-flex min-h-10 items-center rounded-[5px] px-3 text-sm ${active ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2 hover:text-ink"}`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
