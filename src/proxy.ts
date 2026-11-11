import { type NextRequest, NextResponse } from "next/server";
import { legacyRedirect } from "./lib/legacy-redirect";

/** Sends the old GlobalCart addresses to the signed-in account's own pages. */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const target = legacyRedirect(pathname, search, req.headers.get("cookie"));
  return target ? NextResponse.redirect(new URL(target, req.url)) : NextResponse.next();
}

export const config = {
  matcher: ["/seller/:path*", "/buyer/:path*", "/shop", "/cart", "/orders", "/checkout/:path*"],
};
