import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/routes";
import { type Principal, principalFromToken, SESSION_COOKIE } from "./auth";

/** Server components read the same signed cookie as the API routes. */
async function currentSession(): Promise<Principal | null> {
  return principalFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** The signed-in freelancer; a /freelancer/<id> address with someone else's id is "not found". */
export async function freelancerPage(urlId?: string): Promise<Extract<Principal, { role: "FREELANCER" }>> {
  const p = await currentSession();
  if (p?.role !== "FREELANCER") redirect("/login");
  if (urlId !== undefined && (!isUuid(urlId) || urlId !== p.freelancerId)) notFound();
  return p;
}

export async function clientPage(urlId?: string): Promise<Extract<Principal, { role: "CLIENT" }>> {
  const p = await currentSession();
  if (p?.role !== "CLIENT") redirect("/login");
  if (urlId !== undefined && (!isUuid(urlId) || urlId !== p.clientId)) notFound();
  return p;
}

/** Any signed-in GlobalGig account, or null (landing page, login). */
export async function currentPrincipal(): Promise<Principal | null> {
  return currentSession();
}
