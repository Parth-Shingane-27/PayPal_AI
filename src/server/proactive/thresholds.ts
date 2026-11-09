/** Detector thresholds in one place so tests and the demo seed can reason about them. */

export const DAY_MS = 86_400_000;

export const THRESHOLDS = {
  /** refund_rate_spike: this week's refund share vs the trailing baseline. */
  refundRate: { minRefunds: 2, minOrders: 3, multiple: 2, minAbsolutePoints: 15, baselineWeeks: 8 },
  /** earnings_drop: a market's net this week vs the week before. */
  earningsDrop: { minPriorOrders: 3, dropFraction: 0.4 },
  /** stuck_pending_payment: orders left unpaid this long. */
  stuckPendingDays: 7,
  /** approval_aging: a proposal waiting for the seller this long. */
  approvalAgingDays: 3,
  /** idle_balance: money available and unpaid for this long, at least this share of the fee-cap size. */
  idleBalance: { days: 21, minShareOfCapThreshold: 0.4 },
  /** fx_drag: conversion cost as a share of gross. The normal spread is 3%, so only a market clearly above it is worth saying. */
  fxDrag: { minOrders: 3, minSharePercent: 4 },
  /** forecast_shift: next-30-day trend vs the previous 28 days. */
  forecastShift: { minTrendPercent: 50 },
} as const;

/** Agent runs per seller per UTC day; beyond this findings still save, with template text. */
export const MAX_PROACTIVE_RUNS_PER_DAY = 6;
