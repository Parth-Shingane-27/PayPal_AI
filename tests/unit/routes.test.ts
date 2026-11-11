import { describe, expect, it } from "vitest";
import { identityFromCookie, legacyRedirect } from "@/lib/legacy-redirect";
import { clientPath, freelancerPath, isUuid } from "@/lib/routes";

const F = "01a1b222-a0a1-73c8-b686-07974d538bd0";
const C = "01a1b222-b1b2-7c3d-a4e5-0123456789ab";

/** A cookie shaped like the app's session: base64url(JSON payload).signature */
const cookie = (role: string, id: string) => {
  const payload = Buffer.from(JSON.stringify({ role, id, market: null, exp: 9999999999 })).toString("base64url");
  return `theme=x; gg_session=${payload}.signature; other=1`;
};

describe("account paths", () => {
  it("builds freelancer and client addresses", () => {
    expect(freelancerPath(F)).toBe(`/freelancer/${F}`);
    expect(freelancerPath(F, "earnings")).toBe(`/freelancer/${F}/earnings`);
    expect(freelancerPath(F, "/services/abc")).toBe(`/freelancer/${F}/services/abc`);
    expect(clientPath(C, "checkout/return")).toBe(`/client/${C}/checkout/return`);
  });
  it("recognises ids", () => {
    expect(isUuid(F)).toBe(true);
    expect(isUuid("earnings")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("legacy address redirects", () => {
  it("lets current addresses and unrelated paths through", () => {
    expect(legacyRedirect(`/freelancer/${F}/earnings`, "", cookie("FREELANCER", F))).toBeNull();
    expect(legacyRedirect(`/client/${C}`, "", null)).toBeNull();
    expect(legacyRedirect("/login", "", null)).toBeNull();
    expect(legacyRedirect("/api/contracts", "", null)).toBeNull();
  });

  it("moves old seller pages to the signed-in freelancer, keeping the query", () => {
    const c = cookie("FREELANCER", F);
    expect(legacyRedirect("/seller", "", c)).toBe(`/freelancer/${F}`);
    expect(legacyRedirect("/seller/ledger", "?tab=orders&period=all_time", c)).toBe(`/freelancer/${F}/earnings?tab=orders&period=all_time`);
    expect(legacyRedirect("/seller/treasury", "", c)).toBe(`/freelancer/${F}/earnings`);
    expect(legacyRedirect("/seller/operations", "", c)).toBe(`/freelancer/${F}/projects`);
    expect(legacyRedirect("/seller/products/123", "", c)).toBe(`/freelancer/${F}/services`);
    expect(legacyRedirect("/seller/messages", "?c=9", c)).toBe(`/freelancer/${F}/messages?c=9`);
  });

  it("also moves old account addresses, which no longer have pages", () => {
    expect(legacyRedirect(`/seller/${C}/ledger`, "", cookie("FREELANCER", F))).toBe(`/freelancer/${F}/earnings`);
    expect(legacyRedirect(`/buyer/${C}/orders`, "", cookie("CLIENT", C))).toBe(`/client/${C}/projects`);
  });

  it("moves old buyer pages to the signed-in client", () => {
    const c = cookie("CLIENT", C);
    expect(legacyRedirect("/buyer", "", c)).toBe(`/client/${C}`);
    expect(legacyRedirect("/buyer/messages", "?c=9", c)).toBe(`/client/${C}/messages?c=9`);
    expect(legacyRedirect("/shop", "", c)).toBe(`/client/${C}/find`);
    expect(legacyRedirect("/cart", "?cancelled=o1", c)).toBe(`/client/${C}/projects?cancelled=o1`);
    expect(legacyRedirect("/orders", "", c)).toBe(`/client/${C}/projects`);
    // A PayPal return URL saved before per-account links still lands in the right place.
    expect(legacyRedirect("/checkout/return", "?token=T", c)).toBe(`/client/${C}/checkout/return?token=T`);
  });

  it("sends signed-out, wrong-role and old-role visitors to /login", () => {
    expect(legacyRedirect("/seller/ledger", "", null)).toBe("/login");
    expect(legacyRedirect("/shop", "", cookie("FREELANCER", F))).toBe("/login");
    expect(legacyRedirect("/seller", "", cookie("CLIENT", C))).toBe("/login");
    expect(legacyRedirect("/seller", "", cookie("SELLER", F))).toBe("/login");
    expect(legacyRedirect("/seller", "", "gg_session=garbage")).toBe("/login");
  });

  it("reads the session cookie among others and ignores bad ids", () => {
    expect(identityFromCookie(cookie("CLIENT", C))).toEqual({ role: "CLIENT", id: C });
    expect(identityFromCookie(cookie("CLIENT", "not-a-uuid"))).toBeNull();
    expect(identityFromCookie("a=b")).toBeNull();
  });
});
