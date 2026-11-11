import { isUuid } from "./routes";

/**
 * GlobalCart addresses (/seller/..., /buyer/..., /shop, /cart, /orders and
 * old PayPal return URLs) redirect to the matching page of the signed-in
 * freelancer or client. Pure so it can be tested; the proxy only wires it to
 * requests.
 *
 * The cookie payload is decoded WITHOUT checking its signature: the id is only
 * used to build a redirect target, and the page that loads there verifies the
 * signature before showing anything.
 */

type Who = { role: "FREELANCER" | "CLIENT"; id: string } | null;

export function identityFromCookie(cookieHeader: string | null | undefined): Who {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("gg_session="));
  if (!raw) return null;
  try {
    const token = decodeURIComponent(raw.slice("gg_session=".length));
    const payload = JSON.parse(atob(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string; id?: string };
    if ((payload.role === "FREELANCER" || payload.role === "CLIENT") && isUuid(payload.id)) return { role: payload.role, id: payload.id };
  } catch {
    // Unreadable cookie: treated as signed out.
  }
  return null;
}

/** Old first path segment -> page of the new workspace. Anything not listed keeps its name. */
const FREELANCER_PAGES: Record<string, string> = { ledger: "earnings", treasury: "earnings", operations: "projects", products: "services" };
const CLIENT_PAGES: Record<string, string> = { shop: "find", cart: "projects", orders: "projects" };
/** Buyer pages that used to sit at the site root. */
const CLIENT_ROOT_PAGES = new Set(["shop", "cart", "orders", "checkout"]);

/**
 * Returns the path to redirect to, or null to let the request through.
 * `search` includes the leading "?" (or is empty).
 */
export function legacyRedirect(pathname: string, search: string, cookieHeader: string | null | undefined): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const [first] = parts;
  const isSeller = first === "seller";
  const isBuyer = first === "buyer" || CLIENT_ROOT_PAGES.has(first ?? "");
  if (!isSeller && !isBuyer) return null;

  const who = identityFromCookie(cookieHeader);
  if (!who || who.role !== (isSeller ? "FREELANCER" : "CLIENT")) return "/login";

  let rest = first === "seller" || first === "buyer" ? parts.slice(1) : parts;
  if (isUuid(rest[0])) rest = rest.slice(1);
  const page = rest[0] ? ((isSeller ? FREELANCER_PAGES : CLIENT_PAGES)[rest[0]] ?? rest[0]) : "";
  // An old product or order id means nothing on the new pages: land on the list.
  const tail = page === "services" || page === "projects" ? [] : rest.slice(1);
  const base = who.role === "FREELANCER" ? `/freelancer/${who.id}` : `/client/${who.id}`;
  const path = [page, ...tail].filter(Boolean).join("/");
  return `${base}${path ? `/${path}` : ""}${search}`;
}
