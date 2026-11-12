/** Detector thresholds in one place so tests and the demo seed can reason about them. */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export const THRESHOLDS = {
  /** milestone_due_soon: funded work due within this many hours with nothing delivered. */
  dueSoonHours: 48,
  /** awaiting_acceptance: a delivery whose auto-release is this close. */
  autoReleaseWithinHours: 72,
  /** approval_aging: a proposal waiting for the freelancer this long. */
  approvalAgingDays: 3,
  /** idle_balance: money available and unpaid this long, at least this share of the fee-cap size. */
  idleBalance: { days: 21, minShareOfCapThreshold: 0.4 },
} as const;

/** Agent runs per freelancer per UTC day; beyond this findings still save, with template text. */
export const MAX_PROACTIVE_RUNS_PER_DAY = 6;
