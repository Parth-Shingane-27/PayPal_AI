/** Pure helpers behind the dashboards. No I/O, so they are unit-tested directly. */

const DAY = 86_400_000;

/** "YYYY-MM" for a date, in UTC. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** The last `n` month keys ending with the month of `now`, oldest first. */
export function lastMonthKeys(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}

/**
 * How far through a month `now` is. Only the current month is partial: its
 * figures cover days_elapsed of days_in_month, so a chart must not present it
 * as a finished month.
 */
export function monthProgress(key: string, now: Date): { partial: boolean; days_elapsed: number; days_in_month: number } {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const days_in_month = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const partial = key === monthKey(now);
  return { partial, days_elapsed: partial ? now.getUTCDate() : days_in_month, days_in_month };
}

/** Index 0..weeks-1 of the week (oldest first) a date falls in, counting back from `now`; -1 if outside. */
export function weekIndex(d: Date, now: Date, weeks: number): number {
  const age = Math.floor((now.getTime() - d.getTime()) / (7 * DAY));
  if (age < 0 || age >= weeks) return -1;
  return weeks - 1 - age;
}

/**
 * Splits an integer total across weights by the largest-remainder method, so
 * the parts are integers that sum exactly to the total.
 */
export function allocateByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.trunc(r));
  let rest = total - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) })).sort((a, b) => b.frac - a.frac);
  const step = rest >= 0 ? 1 : -1;
  for (let k = 0; rest !== 0 && k < order.length * 2; k++) {
    parts[order[k % order.length]!.i]! += step;
    rest -= step;
  }
  return parts;
}

/** Ratio in basis points (0..10000+), 0 when the denominator is 0. */
export function ratioBps(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator * 10_000) / denominator) : 0;
}

/** Change from `prev` to `curr` in basis points; null when there is no baseline. */
export function changeBps(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) * 10_000) / Math.abs(prev));
}
