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
