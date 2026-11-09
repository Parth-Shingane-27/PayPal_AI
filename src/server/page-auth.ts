import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/routes";
import { type Principal, principalFromToken, SESSION_COOKIE } from "./auth";

/** Server components read the same signed cookie as the API routes. */
async function currentPrincipal(): Promise<Principal | null> {
  return principalFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * The signed-in seller. When the page was reached through /seller/<id>, pass
 * that id: it must be the session's own id, otherwise the page is "not found"
 * (the same answer another tenant's id gets everywhere else). The URL id is
 * never used for access, only compared.
 */
export async function sellerPage(urlId?: string): Promise<Extract<Principal, { role: "SELLER" }>> {
  const p = await currentPrincipal();
  if (p?.role !== "SELLER") redirect("/login");
  if (urlId !== undefined && (!isUuid(urlId) || urlId !== p.sellerId)) notFound();
  return p;
}

export async function buyerPage(urlId?: string): Promise<Extract<Principal, { role: "BUYER" }>> {
  const p = await currentPrincipal();
  if (p?.role !== "BUYER") redirect("/login");
  if (urlId !== undefined && (!isUuid(urlId) || urlId !== p.buyerId)) notFound();
  return p;
}
