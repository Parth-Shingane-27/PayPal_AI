import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type Principal, principalFromToken, SESSION_COOKIE } from "./auth";

/** Server components read the same signed cookie as the API routes. */
async function currentPrincipal(): Promise<Principal | null> {
  return principalFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function sellerPage(): Promise<Extract<Principal, { role: "SELLER" }>> {
  const p = await currentPrincipal();
  if (p?.role !== "SELLER") redirect("/login");
  return p;
}

export async function buyerPage(): Promise<Extract<Principal, { role: "BUYER" }>> {
  const p = await currentPrincipal();
  if (p?.role !== "BUYER") redirect("/login");
  return p;
}
