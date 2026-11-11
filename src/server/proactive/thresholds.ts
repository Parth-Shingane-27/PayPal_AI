/** Detector thresholds in one place so tests and the demo seed can reason about them. */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export const THRESHOLDS = {
  /** milestone_due_soon: funded work due within this many hours with nothing delivered. */
  dueSoonHours: 48,
  /** awaiting_acceptance: a delivery whose auto-release is this close. */
  autoReleaseWithinHours: 72,
  /** revision_loop: an open milestone sent back this many times. */
  revisionLoop: 3,
  /** refund_rate_spike: refunds over the last 30 days vs the 90 days before. */
  refundRate: { minRefunds: 2, minMilestones: 3, multiple: 2, minAbsolutePoints: 15 },
  /** quote_requests_unanswered: a client has waited this long for a price. */
  unansweredQuoteHours: 24,
  /** approval_aging: a proposal waiting for the freelancer this long. */
  approvalAgingDays: 3,
  /** idle_balance: money available and unpaid this long, at least this share of the fee-cap size. */
  idleBalance: { days: 21, minShareOfCapThreshold: 0.4 },
  /** fx_drag: FX cost as a share of released gross in a market (normal spread is 3%). */
  fxDrag: { minMilestones: 3, minSharePercent: 4 },
  /** forecast_shift: released money in the last 28 days vs the 28 before. */
  forecastShift: { minTrendPercent: 50 },
  /** large_holding_inflow: money funded in the last 7 days, vs the median milestone. */
  largeHolding: { days: 7, multipleOfMedian: 3 },
} as const;

/** Agent runs per freelancer per UTC day; beyond this findings still save, with template text. */
export const MAX_PROACTIVE_RUNS_PER_DAY = 6;
