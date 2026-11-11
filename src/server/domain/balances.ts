import { applyBps } from "./money";

/**
 * Freelancer money maths, pure. Per currency:
 *   released  = net_to_freelancer of released (ACCEPTED) milestone payments
 *   refunded  = freelancer debits for refunds made after release
 *   paidOut   = amount + fee of PROCESSING and SUCCESS payouts
 *   reserved  = amount + fee of SCHEDULED payouts
 *   available = released - refunded - paidOut - reserved
 *   inHolding = gross of funded milestones not yet released, less refunds made
 *               from holding. Shown separately; never available for payout.
 */

export type BalanceLine = {
  currency: string;
  released: number;
  refunded: number;
  paidOut: number;
  reserved: number;
  available: number;
  inHolding: number;
};

export type BalanceEntry =
  | { kind: "released"; currency: string; amountMinor: number }
  | { kind: "refunded"; currency: string; amountMinor: number }
  | { kind: "paid_out"; currency: string; amountMinor: number }
  | { kind: "reserved"; currency: string; amountMinor: number }
  | { kind: "in_holding"; currency: string; amountMinor: number };

/** Folds entries into one line per currency, sorted by currency code. */
export function balanceLines(entries: readonly BalanceEntry[]): BalanceLine[] {
  const lines = new Map<string, BalanceLine>();
  for (const e of entries) {
    if (!Number.isSafeInteger(e.amountMinor)) throw new Error(`Balance amounts must be integers, got ${e.amountMinor}`);
    let l = lines.get(e.currency);
    if (!l) lines.set(e.currency, (l = { currency: e.currency, released: 0, refunded: 0, paidOut: 0, reserved: 0, available: 0, inHolding: 0 }));
    switch (e.kind) {
      case "released":
        l.released += e.amountMinor;
        break;
      case "refunded":
        l.refunded += e.amountMinor;
        break;
      case "paid_out":
        l.paidOut += e.amountMinor;
        break;
      case "reserved":
        l.reserved += e.amountMinor;
        break;
      case "in_holding":
        l.inHolding += e.amountMinor;
        break;
    }
  }
  for (const l of lines.values()) l.available = availableOf(l);
  return [...lines.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function availableOf(l: Pick<BalanceLine, "released" | "refunded" | "paidOut" | "reserved">): number {
  return l.released - l.refunded - l.paidOut - l.reserved;
}

// --- Release ------------------------------------------------------------------

export type CapturedFees = {
  grossMinor: number;
  paypalFeeMinor: number;
  platformFeeMinor: number;
  fxCostMinor: number;
};

export type RefundBeforeRelease = {
  amountMinor: number;
  paypalFeeReturnedMinor: number;
  platformFeeReturnedMinor: number;
};

/**
 * Net to the freelancer, recorded when a milestone is released:
 *   net = gross - PayPal fee - platform fee - FX cost
 * A refund made from holding before release (a partially refunded dispute)
 * takes its amount off the gross and gives back the fees it returned.
 */
export function netOnRelease(fees: CapturedFees, refundsFromHolding: readonly RefundBeforeRelease[] = []): number {
  const refunded = refundsFromHolding.reduce((s, r) => s + r.amountMinor, 0);
  const paypalBack = refundsFromHolding.reduce((s, r) => s + r.paypalFeeReturnedMinor, 0);
  const platformBack = refundsFromHolding.reduce((s, r) => s + r.platformFeeReturnedMinor, 0);
  if (refunded > fees.grossMinor) throw new Error("Refunds exceed the milestone payment.");
  return fees.grossMinor - refunded - (fees.paypalFeeMinor - paypalBack) - (fees.platformFeeMinor - platformBack) - fees.fxCostMinor;
}

/** What is still in holding for one funded milestone. */
export function holdingOf(grossMinor: number, refundedFromHoldingMinor: number): number {
  return Math.max(0, grossMinor - refundedFromHoldingMinor);
}

// --- Refunds ------------------------------------------------------------------

/**
 * Splits a refund between who pays for it:
 *   platform_fee_returned = round(platform_fee * amount / gross)
 *   From holding (not yet released): nothing is debited from the freelancer;
 *     the money never reached their balance.
 *   After release: freelancer_debit = amount - paypal_fee_returned - platform_fee_returned.
 */
export function refundSplit(input: {
  amountMinor: number;
  grossMinor: number;
  platformFeeMinor: number;
  paypalFeeReturnedMinor: number;
  fromHolding: boolean;
}): { platformFeeReturnedMinor: number; freelancerDebitMinor: number } {
  const { amountMinor, grossMinor, platformFeeMinor, paypalFeeReturnedMinor } = input;
  if (amountMinor <= 0 || amountMinor > grossMinor) throw new Error("Refund amount must be between 1 and the payment gross.");
  const platformFeeReturnedMinor = Math.round((platformFeeMinor * amountMinor) / grossMinor);
  const freelancerDebitMinor = input.fromHolding ? 0 : amountMinor - paypalFeeReturnedMinor - platformFeeReturnedMinor;
  return { platformFeeReturnedMinor, freelancerDebitMinor };
}

/** Platform fee on a gross amount (PLATFORM_FEE_BPS). */
export function platformFee(grossMinor: number, bps: number): number {
  return applyBps(grossMinor, bps);
}
