import type { Tx } from "../../db";
import { notFound } from "../../errors";
import type { Actor } from "../audit";

/**
 * Who is asking, as the session says. Every GlobalGig service takes one of
 * these and filters by it, so another tenant's id reads as "not found".
 */
export type GigOwner =
  | { type: "FREELANCER"; freelancerId: string; locale: string }
  | { type: "CLIENT"; clientId: string; locale: string };

/** Prisma `where` fragment for rows that carry both freelancer_id and client_id. */
export function ownerWhere(o: GigOwner): { freelancer_id: string } | { client_id: string } {
  return o.type === "FREELANCER" ? { freelancer_id: o.freelancerId } : { client_id: o.clientId };
}

export function actorOf(o: GigOwner): Actor {
  return o.type === "FREELANCER" ? { type: "FREELANCER", freelancerId: o.freelancerId } : { type: "CLIENT", clientId: o.clientId };
}

export const ownerId = (o: GigOwner) => (o.type === "FREELANCER" ? o.freelancerId : o.clientId);

/**
 * Row locks that serialise money-changing work:
 *  - the client row guards milestone funding (one live PayPal order per milestone);
 *  - the freelancer row guards balance checks (refunds, payouts) and invoice numbers.
 */
export async function lockClient(tx: Tx, clientId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM clients WHERE id = ${clientId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound("Client");
}

export async function lockFreelancer(tx: Tx, freelancerId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM freelancers WHERE id = ${freelancerId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound("Freelancer");
}
