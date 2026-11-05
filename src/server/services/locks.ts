import type { Tx } from "../db";
import { notFound } from "../errors";

/**
 * Row locks that serialise money-changing work:
 *  - the buyer row guards carts and checkout (one open order per tuple);
 *  - the seller row guards ledger checks (refunds and payouts).
 */
export async function lockBuyer(tx: Tx, buyerId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM buyers WHERE id = ${buyerId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound("Buyer");
}

export async function lockSeller(tx: Tx, sellerId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sellers WHERE id = ${sellerId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound("Seller");
}
