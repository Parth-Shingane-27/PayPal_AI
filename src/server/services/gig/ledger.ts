import { type Db, prisma } from "../../db";
import { type BalanceEntry, type BalanceLine, balanceLines } from "../../domain/balances";
import { money } from "../../domain/money";

/**
 * Freelancer ledger, per currency (formula in domain/balances.ts):
 *   released  = net_to_freelancer of released milestone payments
 *   refunded  = freelancer debits of PENDING / COMPLETED refunds made after release
 *   paidOut   = amount + fee of PROCESSING / SUCCESS payouts
 *   reserved  = amount + fee of SCHEDULED payouts
 *   available = released - refunded - paidOut - reserved
 *   inHolding = gross of captured, unreleased payments on milestones still in
 *               holding, less refunds taken from holding. Never available.
 */
export async function freelancerLedger(freelancerId: string, db: Db = prisma): Promise<BalanceLine[]> {
  const [released, debits, payouts, held, heldRefunds] = await Promise.all([
    db.milestonePayment.groupBy({
      by: ["currency"],
      where: { freelancer_id: freelancerId, status: "COMPLETED", released_at: { not: null } },
      _sum: { net_to_freelancer_minor: true },
    }),
    db.milestoneRefund.groupBy({
      by: ["currency"],
      where: { freelancer_id: freelancerId, from_holding: false, status: { in: ["PENDING", "COMPLETED"] } },
      _sum: { freelancer_debit_minor: true },
    }),
    db.freelancerPayout.groupBy({
      by: ["currency", "status"],
      where: { freelancer_id: freelancerId, status: { in: ["SCHEDULED", "PROCESSING", "SUCCESS"] } },
      _sum: { amount_minor: true, fee_minor: true },
    }),
    db.milestonePayment.groupBy({
      by: ["currency"],
      where: {
        freelancer_id: freelancerId,
        status: "COMPLETED",
        released_at: null,
        milestone: { state: { in: ["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"] } },
      },
      _sum: { gross_minor: true },
    }),
    db.milestoneRefund.groupBy({
      by: ["currency"],
      where: {
        freelancer_id: freelancerId,
        from_holding: true,
        status: { in: ["PENDING", "COMPLETED"] },
        payment: { released_at: null },
        milestone: { state: { in: ["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"] } },
      },
      _sum: { amount_minor: true },
    }),
  ]);

  const entries: BalanceEntry[] = [];
  for (const r of released) entries.push({ kind: "released", currency: r.currency, amountMinor: r._sum.net_to_freelancer_minor ?? 0 });
  for (const d of debits) entries.push({ kind: "refunded", currency: d.currency, amountMinor: d._sum.freelancer_debit_minor ?? 0 });
  for (const p of payouts) {
    const total = (p._sum.amount_minor ?? 0) + (p._sum.fee_minor ?? 0);
    entries.push({ kind: p.status === "SCHEDULED" ? "reserved" : "paid_out", currency: p.currency, amountMinor: total });
  }
  for (const h of held) entries.push({ kind: "in_holding", currency: h.currency, amountMinor: h._sum.gross_minor ?? 0 });
  for (const r of heldRefunds) entries.push({ kind: "in_holding", currency: r.currency, amountMinor: -(r._sum.amount_minor ?? 0) });
  return balanceLines(entries);
}

export async function availableFor(freelancerId: string, currency: string, db: Db = prisma): Promise<number> {
  return (await freelancerLedger(freelancerId, db)).find((l) => l.currency === currency)?.available ?? 0;
}

/** get_balances: available vs in holding, with display strings. */
export async function freelancerBalancesView(freelancerId: string, locale: string) {
  const lines = await freelancerLedger(freelancerId);
  const m = (minor: number, c: string) => money(minor, c, locale);
  return {
    balances: lines.map((l) => ({
      currency: l.currency,
      available: m(l.available, l.currency),
      in_holding: m(l.inHolding, l.currency),
      released: m(l.released, l.currency),
      refunded: m(l.refunded, l.currency),
      paid_out: m(l.paidOut, l.currency),
      reserved_for_scheduled_payouts: m(l.reserved, l.currency),
    })),
    definitions:
      "available = released - refunded - paid_out - reserved, and only this can be paid out. in_holding = client money for funded milestones that the client has not accepted yet; it becomes released when the client clicks Accept delivery (or automatically after the auto-release period), and is never available before that. released = net of accepted milestones after PayPal, platform and FX fees.",
  };
}
