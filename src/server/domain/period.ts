import { AppError } from "../errors";

/** Reporting periods shared by dashboards, the ledger grid and agent tools. */

export const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "year_to_date",
  "all_time",
] as const;
type PeriodPreset = (typeof PERIOD_PRESETS)[number];

type Period = { from: Date; to: Date; label: string };

const DAY = 86_400_000;

function utcDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError("INVALID_INPUT", `Dates must be YYYY-MM-DD; got "${s}".`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new AppError("INVALID_INPUT", `Invalid date "${s}".`);
  return d;
}

/** Resolves a preset or an explicit [from, to] (both inclusive dates, UTC). */
export function resolvePeriod(input: { preset?: PeriodPreset; from?: string; to?: string }, now = new Date()): Period {
  if (input.from || input.to) {
    if (!input.from || !input.to) throw new AppError("INVALID_INPUT", "Give both from and to dates.");
    const from = utcDate(input.from);
    const to = new Date(utcDate(input.to).getTime() + DAY);
    if (to <= from) throw new AppError("INVALID_INPUT", "The end date must not be before the start date.");
    return { from, to, label: `${input.from} to ${input.to}` };
  }
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startOfToday = Date.UTC(y, m, now.getUTCDate());
  const tomorrow = new Date(startOfToday + DAY);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const period = (from: Date, to: Date, name: string): Period => ({
    from,
    to,
    label: `${name} (${iso(from)} to ${iso(new Date(to.getTime() - DAY))})`,
  });
  switch (input.preset ?? "last_30_days") {
    case "this_month":
      return period(new Date(Date.UTC(y, m, 1)), tomorrow, "this month");
    case "last_month":
      return period(new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1)), "last month");
    case "last_7_days":
      return period(new Date(startOfToday - 6 * DAY), tomorrow, "last 7 days");
    case "last_30_days":
      return period(new Date(startOfToday - 29 * DAY), tomorrow, "last 30 days");
    case "last_90_days":
      return period(new Date(startOfToday - 89 * DAY), tomorrow, "last 90 days");
    case "year_to_date":
      return period(new Date(Date.UTC(y, 0, 1)), tomorrow, "year to date");
    case "all_time":
      return { from: new Date(0), to: tomorrow, label: "all time" };
  }
}
