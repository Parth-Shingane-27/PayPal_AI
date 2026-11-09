import { isUuid } from "./routes";

/**
 * Old shared addresses (/seller/ledger, /shop, a PayPal return URL saved
 * before per-account links) redirect to the signed-in account's own address.
 * Pure so it can be tested; the proxy only wires it to requests.
 *
 * The cookie payload is decoded WITHOUT checking its signature: the id is only
 * used to build a redirect target, and the page that loads there verifies the
 * signature before showing anything.
 */

type Who = { role: "SELLER" | "BUYER"; id: string } | null;

export function identityFromCookie(cookieHeader: string | null | undefined): Who {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("gc_session="));
  if (!raw) return null;
  try {
    const token = decodeURIComponent(raw.slice("gc_session=".length));
    const payload = JSON.parse(atob(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string; id?: string };
    if ((payload.role === "SELLER" || payload.role === "BUYER") && isUuid(payload.id)) return { role: payload.role, id: payload.id };
  } catch {
    // Unreadable cookie: treated as signed out.
  }
  return null;
}

/** Buyer pages that used to sit at the site root. */
const BUYER_ROOT_PAGES = new Set(["shop", "cart", "orders", "checkout"]);

/**
 * Returns the path to redirect to, or null to let the request through.
 * `search` includes the leading "?" (or is empty).
 */
export function legacyRedirect(pathname: string, search: string, cookieHeader: string | null | undefined): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const [first, second] = parts;
  if (first !== "seller" && first !== "buyer" && !BUYER_ROOT_PAGES.has(first ?? "")) return null;

  // Already an account address: /seller/<uuid>/... or /buyer/<uuid>/...
  if ((first === "seller" || first === "buyer") && isUuid(second)) return null;

  const who = identityFromCookie(cookieHeader);
  const wantRole = first === "seller" ? "SELLER" : "BUYER";
  if (!who || who.role !== wantRole) return "/login";

  const rest = first === "seller" || first === "buyer" ? parts.slice(1) : parts;
  const base = who.role === "SELLER" ? `/seller/${who.id}` : `/buyer/${who.id}`;
  return `${base}${rest.length ? `/${rest.join("/")}` : ""}${search}`;
}
